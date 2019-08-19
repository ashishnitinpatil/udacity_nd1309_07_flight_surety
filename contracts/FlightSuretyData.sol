pragma solidity 0.5.8;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";


contract FlightSuretyData is Ownable {
    using SafeMath for uint256;

    // Blocks all state changes throughout the contract if false
    bool private operational = true;

    // Contracts that are allowed to call functions in this contract
    mapping(address => bool) private authorizedContracts;
    // Tracks number of authorizedContracts
    uint256 private numAuthorizedContracts = 0;

    mapping(address => bool) private airlines;
    uint256 private numAirlines = 0;
    mapping(address => uint256) private funding;

    struct Flight {
        uint8 status;
        address airline;
        string flight;
        uint256 timestamp;
        address[] insurees;
        mapping(address => uint256) insuredAmounts;
        bool isProcessed;
    }

    mapping(bytes32 => Flight) private flights;

    mapping(address => uint256) private credits;

    event OperationStatusSet(bool status);

    // Contract authorization events
    event ContractAuthorized(address authorizedContract);
    event ContractDeauthorized(address deauthorizedContract);

    // Contract funding event
    event Funded(address fundedBy, uint256 fundingAmount);

    // Airline registration events
    event AirlineRegistered(address airline);
    event AirlineDeregistered(address airline);
    event FlightRegistered(
        bytes32 flightKey,
        address airline,
        string flight,
        uint256 timestamp
    );

    // Insurance events
    event InsuranceBought(
        address airline,
        string flight,
        uint256 timestamp,
        address insuree,
        uint256 insuredAmount
    );
    event InsureesCredited(
        address airline,
        string flight,
        uint256 timestamp,
        uint256 totalPayout
    );

    /**
    * @dev Modifier that requires the "operational" boolean variable to be "true"
    *      This is used on all state changing functions to pause the contract in
    *      the event there is an issue that needs to be fixed
    */
    modifier requireIsOperational()
    {
        require(operational, "Data contract is currently not operational");
        _;
    }

    /**
    * @dev Modifier that requires the caller to be an authorized contract
    *      or the contract owner in case there are no authorized contracts.
    *      This effectively gives the ownership of this contract back to the
    *      authorized calling contract instead of the contract creator.
    */
    modifier requireAuthorization()
    {
        if(numAuthorizedContracts > 0) {
            require(authorizedContracts[msg.sender], "Caller is not an authorized contract");
        }
        else {
            require(owner() == tx.origin, "Caller is not contract owner");
        }
        _;
    }

    /**
    * @dev Modifier that requires the caller to explicitly be an authorized contract
    */
    modifier requireAuthorizedContract()
    {
        require(authorizedContracts[msg.sender], "Caller is not an authorized contract");
        _;
    }

    /**
    * @dev Fallback function for funding smart contract.
    *
    */
    function()
        external
        payable
    {
        fund();
    }

    /**
    * @dev Whitelists a contract so that it may call this contract
    */
    function authorizeContract(address authorizedContract)
        external
        requireAuthorization
    {
        authorizedContracts[authorizedContract] = true;
        numAuthorizedContracts = numAuthorizedContracts.add(1);
        emit ContractAuthorized(authorizedContract);
    }

    /**
    * @dev Delist an authorized contract so that it can't call this contract
    */
    function deauthorizeContract(address deauthorizedContract)
        external
        requireAuthorization
    {
        numAuthorizedContracts = numAuthorizedContracts.sub(1);
        delete authorizedContracts[deauthorizedContract];
        emit ContractDeauthorized(deauthorizedContract);
    }

    /**
    * @dev Sets contract operations on/off
    *
    * When operational mode is disabled, all write transactions except for this one will fail
    */
    function setOperatingStatus(bool mode)
        external
        requireAuthorization
    {
        operational = mode;
        emit OperationStatusSet(mode);
    }

    /**
    * @dev Add an airline to the registration queue
    *      Can only be called from FlightSuretyApp contract
    *
    */
    function registerAirline(address airline)
        external
        requireIsOperational
        requireAuthorization
    {
        if(!airlines[airline]) {
            airlines[airline] = true;
            numAirlines = numAirlines.add(1);
            emit AirlineRegistered(airline);
        }
    }

    /**
    * @dev Remove an airline from the registration queue
    *      Can only be called from FlightSuretyApp contract
    *
    */
    function deregisterAirline(address airline)
        external
        requireIsOperational
        requireAuthorization
    {
        if(airlines[airline]) {
            delete airlines[airline];
            numAirlines = numAirlines.sub(1);
            emit AirlineDeregistered(airline);
        }
    }

    /**
    * @dev Register a future flight for insuring
    */
    function registerFlight(
        address airline,
        string calldata flight,
        uint256 timestamp
    )
        external
        requireAuthorizedContract
        requireIsOperational
    {
        bytes32 flightKey = getFlightKey(airline, flight, timestamp);
        Flight memory f;
        f.airline = airline;
        f.flight = flight;
        f.timestamp = timestamp;
        f.isProcessed = false;
        flights[flightKey] = f;
        emit FlightRegistered(flightKey, airline, flight, timestamp);
    }

    /**
    * @dev Buy insurance for a flight
    */
    function buyInsurance(
        address airline,
        string calldata flight,
        uint256 timestamp
    )
        external
        payable
        requireAuthorizedContract
        requireIsOperational
    {
        bytes32 flightKey = getFlightKey(airline, flight, timestamp);
        // Prevent buying against invalid flight keys
        require(flights[flightKey].timestamp > 0, "Flight not registered");
        // Prevent double purchase attempts
        require(
            flights[flightKey].insuredAmounts[tx.origin] == 0,
            "Cannot buy more than once"
        );
        flights[flightKey].insurees.push(tx.origin);
        flights[flightKey].insuredAmounts[tx.origin] = msg.value;
        emit InsuranceBought(airline, flight, timestamp, tx.origin, msg.value);
    }

    /**
    * @dev Credits payouts to insurees
    */
    function creditInsurees(bytes32 flightKey, uint256 numerator, uint256 denominator)
        external
        requireAuthorizedContract
        requireIsOperational
    {
        uint256 totalPayout = 0;
        address insuree;
        uint256 payout = 0;
        for(uint256 i=0; i < flights[flightKey].insurees.length; i++) {
            insuree = flights[flightKey].insurees[i];
            payout = flights[flightKey].insuredAmounts[insuree];
            payout = payout * numerator / denominator;
            credits[insuree] = credits[insuree].add(payout);
            totalPayout = totalPayout.add(payout);
        }
        emit InsureesCredited(
            flights[flightKey].airline,
            flights[flightKey].flight,
            flights[flightKey].timestamp,
            totalPayout
        );
    }

    /**
    * @dev Marks given flight as processed
    */
    function markFlightAsProcessed(bytes32 flightKey, uint8 statusCode)
        external
        requireAuthorizedContract
        requireIsOperational
    {
        flights[flightKey].isProcessed = true;
        flights[flightKey].status = statusCode;
    }

    /**
    * @dev Transfers eligible payout funds to insuree
    */
    function payInsuree(address payable insuree, uint256 amount)
        external
        requireAuthorizedContract
        requireIsOperational
    {
        require(amount <= credits[insuree], "Insufficient credits balance");
        credits[insuree] = credits[insuree].sub(amount);
        insuree.transfer(amount);
    }

    /**
    * @dev Get operating status of contract
    */
    function isOperational()
        public
        view
        returns(bool)
    {
        return operational;
    }

    /**
    * @dev Get authorization status of contract
    */
    function isAuthorizedContract(address contractAddr)
        public
        view
        returns(bool)
    {
        return authorizedContracts[contractAddr];
    }

    /**
    * @dev Get registration status of an airline
    */
    function isRegisteredAirline(address airline)
        external
        view
        returns(bool)
    {
        return airlines[airline];
    }

    /**
    * @dev Get number of registered airlines
    */
    function getNumRegisteredAirlines()
        external
        view
        returns(uint256)
    {
        return numAirlines;
    }

    /**
    * @dev Get amount of funding done by an airline
    */
    function getAirlineFundingContribution(address airline)
        external
        view
        returns(uint256)
    {
        return funding[airline];
    }

    /**
    * @dev Returns false if flight is registered and is not processed, else returns true
    */
    function isFlightProcessed(bytes32 flightKey)
        external
        view
        returns(bool)
    {
        return !(flights[flightKey].timestamp != 0 && !flights[flightKey].isProcessed);
    }

    /**
    * @dev Returns flight delay status
    */
    function getFlightStatus(address airline, string calldata flight, uint256 timestamp)
        external
        view
        returns(uint8)
    {
        bytes32 flightKey = getFlightKey(airline, flight, timestamp);
        return flights[flightKey].status;
    }

    /**
    * @dev Returns insuree credits balance from payouts
    */
    function getFundsBalance()
        external
        view
        returns(uint256)
    {
        return credits[msg.sender];
    }

    /**
    * @dev Initial funding for the insurance. Unless there are too many delayed flights
    *      resulting in insurance payouts, the contract should be self-sustaining
    *      Should be directly made to the dataContract
    */
    function fund()
        public
        payable
    {
        uint256 amount = msg.value;
        funding[msg.sender] = funding[msg.sender].add(amount);
        emit Funded(msg.sender, amount);
    }

    function getFlightKey(
        address airline,
        string memory flight,
        uint256 timestamp
    )
        internal
        pure
        returns(bytes32)
    {
        return keccak256(abi.encodePacked(airline, flight, timestamp));
    }
}

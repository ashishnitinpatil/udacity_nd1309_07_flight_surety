pragma solidity 0.5.8;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";


contract FlightSuretyApp is Ownable {
    using SafeMath for uint256;

    FlightSuretyData flightSuretyData;

    // Flight status codes
    uint8 private constant STATUS_CODE_UNKNOWN = 0;
    uint8 private constant STATUS_CODE_ON_TIME = 10;
    uint8 private constant STATUS_CODE_LATE_AIRLINE = 20;
    uint8 private constant STATUS_CODE_LATE_WEATHER = 30;
    uint8 private constant STATUS_CODE_LATE_TECHNICAL = 40;
    uint8 private constant STATUS_CODE_LATE_OTHER = 50;

    // Blocks all state changes throughout the contract if false
    bool private operational = true;

    // Incremented to add pseudo-randomness at various points
    uint8 private nonce = 0;

    // Fee to be paid when registering oracle
    uint256 public constant REGISTRATION_FEE = 1 ether;

    // Minimum funding amount to be paid by an airline
    uint256 public constant MIN_FUNDING_AMOUNT = 10 ether;

    // Maximum allowed limit for insurance premium purchase
    uint256 public constant MAX_PREMIUM = 1 ether;

    // Number of oracles that must respond for valid status
    uint256 private constant MIN_RESPONSES = 3;

    // Payout multiplier in case of flight delay due to airline fault
    uint256 private constant AIRLINE_FAULT_PAYOUT_MULT = 1_5;

    struct Oracle {
        bool isRegistered;
        uint8[3] indexes;
    }

    // Model for responses from oracles
    struct ResponseInfo {
        address requester;  // Account that requested status
        bool isOpen;  // If open, oracle responses are accepted
        // Mapping key is the status code reported;  This lets us group responses
        // and identify the response that majority of the oracles
        mapping(uint8 => address[]) responses;
    }

    // Track votes for operating status change
    uint256 private operatingStatusOnVotes = 0;
    uint256 private operatingStatusOffVotes = 0;
    // Track voters for operating status change
    mapping(address => uint8) private operatingStatusVote;
    address[] private operatingStatusVoters;

    // Track votes for airline registration
    mapping(address => uint256) private airlineRegistrationNumVotes;
    mapping(bytes32 => bool) private airlineRegistrationVote;

    // Track all registered oracles
    mapping(address => Oracle) private oracles;

    // Track all oracle responses
    // Key = hash(index, flight, timestamp)
    mapping(bytes32 => ResponseInfo) private oracleResponses;

    // Event fired each time an oracle submits a response
    event FlightStatusInfo(address airline, string flight, uint256 timestamp, uint8 status);

    event OracleReport(address airline, string flight, uint256 timestamp, uint8 status);

    // Event fired when flight status request is submitted
    // Oracles track this and if they have a matching index
    // they fetch data and submit a response
    event OracleRequest(uint8 index, address airline, string flight, uint256 timestamp);

    /**
    * @dev Modifier that requires the "operational" boolean variable to be "true"
    *      This is used on all state changing functions to pause the contract in
    *      the event there is an issue that needs to be fixed
    */
    modifier requireIsOperational()
    {
        require(operational, "Contract is currently not operational");
        _;
    }

    /**
    * @dev Modifier that requires sender to be a registered airline
    */
    modifier requireRegisteredAirline()
    {
        require(
            flightSuretyData.isRegisteredAirline(msg.sender),
            "Contract is currently not operational"
        );
        _;
    }

    /**
    * @dev Modifier that requires sender airline to have contributed enough funding
    */
    modifier requireMinimumFundingContribution()
    {
        require(
            flightSuretyData.getAirlineFundingContribution(msg.sender) >= 10 ether,
            "Airline has not contributed enough funding"
        );
        _;
    }

    /**
    * @dev Contract constructor
    *      Ideal deployment by an airline that also deployed the dataContract
    *      Authorizes constructed contract to access dataContract
    *      Registers sender as first airline
    */
    constructor(address dataContract)
        public
    {
        flightSuretyData = FlightSuretyData(dataContract);
        // expecting same owner to deploy both contracts first time
        flightSuretyData.authorizeContract(address(this));
        flightSuretyData.registerAirline(msg.sender);
    }

    /**
    * @dev Contract constructor
    */
    function isOperational()
        public
        view
        returns(bool)
    {
        return operational;
    }

    /**
    * @dev Sets contract operations on/off (can do the same with dataContract)
    *      Uses multi-party consensus for triggering the change
    *      When operational mode is disabled, all write transactions except for this one will fail
    */
    function setOperatingStatus(
        bool mode,
        bool setDataContractAlso
    )
        external
        requireRegisteredAirline
        requireMinimumFundingContribution
    {
        if(mode) {
            operatingStatusVote[msg.sender] = 1;  // On
        }
        else {
            operatingStatusVote[msg.sender] = 2;  // Off
        }

        if(operatingStatusVote[msg.sender] == 1) {  // has voted On before
            if(!mode) {
                operatingStatusOnVotes.sub(1);
                operatingStatusOffVotes.add(1);
            }
        }
        else if(operatingStatusVote[msg.sender] == 2) {  // has voted Off before
            if(mode) {
                operatingStatusOffVotes.sub(1);
                operatingStatusOnVotes.add(1);
            }
        }
        else {  // has not voted before
            if(mode) {
                operatingStatusOnVotes.add(1);
            }
            else {
                operatingStatusOffVotes.add(1);
            }
        }

        uint256 numAirlines = flightSuretyData.getNumRegisteredAirlines();

        if(operatingStatusOnVotes.mul(2) >= numAirlines || operatingStatusOffVotes.mul(2) >= numAirlines) {
            operational = mode;  // final vote is always the winning vote
            // reset all tracking variables & mappings
            for(uint256 i=0; i < operatingStatusVoters.length; i++) {
                delete operatingStatusVote[operatingStatusVoters[i]];
            }
            delete operatingStatusVoters;
            operatingStatusOnVotes = 0;
            operatingStatusOffVotes = 0;
            if(setDataContractAlso) {
                flightSuretyData.setOperatingStatus(mode);
            }
        }
    }

    /**
    * @dev Add an airline to the registration queue
    */
    function registerAirline(address airline)
        external
        requireRegisteredAirline
        requireMinimumFundingContribution
        requireIsOperational
        returns(bool success, uint256 votes)
    {
        // Need to track who voted for which airline
        // Since this would require a 2D hashmap, pack sender & airline they
        // are voting to generate unique key to track registration votes
        bytes32 key = keccak256(abi.encodePacked(msg.sender, airline));
        if(!airlineRegistrationVote[key]) {
            airlineRegistrationNumVotes[airline].add(1);
            airlineRegistrationVote[key] = true;
        }
        // Stop processing if already registered
        if(flightSuretyData.isRegisteredAirline(airline)) {
            return (true, airlineRegistrationNumVotes[airline]);
        }
        uint256 numAirlines = flightSuretyData.getNumRegisteredAirlines();
        // Only existing airline may register a new airline until there are
        // at least four airlines registered
        // Registration of fifth and subsequent airlines requires
        // multi-party consensus of 50% of registered airlines
        if(numAirlines < 4 || airlineRegistrationNumVotes[airline].mul(2) >= numAirlines) {
            flightSuretyData.registerAirline(airline);
            return (true, airlineRegistrationNumVotes[airline]);
        }
        else {
            return (false, airlineRegistrationNumVotes[airline]);
        }
    }

    /**
    * @dev An airline can register their own future flight for insuring
    */
    function registerFlight(
        string calldata flight,
        uint256 timestamp
    )
        external
        requireIsOperational
        requireRegisteredAirline
        requireMinimumFundingContribution
    {
        flightSuretyData.registerFlight(msg.sender, flight, timestamp);
    }

    /**
    * @dev Buy flight surety insurance of an upcoming flight
    */
    function buyInsurance(
        address airline,
        string calldata flight,
        uint256 timestamp
    )
        external
        payable
        requireIsOperational
    {
        require(timestamp > now, "Flight has flown");
        require(msg.value <= MAX_PREMIUM, "Cannot buy over the max premium limit");
        flightSuretyData.buyInsurance.value(msg.value)(
            airline,
            flight,
            timestamp
        );
    }

    function withdraw(uint256 amount)
        external
        requireIsOperational
    {
        flightSuretyData.payInsuree(msg.sender, amount);
    }

    /**
    * @dev Called after oracle has updated flight status
    */
    function processFlightStatus(
        bytes32 flightKey,
        uint8 statusCode
    )
        internal
    {
        require(!flightSuretyData.isFlightProcessed(flightKey));
        if(statusCode == STATUS_CODE_LATE_AIRLINE) {
            flightSuretyData.creditInsurees(flightKey, AIRLINE_FAULT_PAYOUT_MULT);
        }
        flightSuretyData.markFlightAsProcessed(flightKey);
    }

    // Generate a request for oracles to fetch flight information
    function fetchFlightStatus(
        address airline,
        string calldata flight,
        uint256 timestamp
    )
        external
    {
        uint8 index = getRandomIndex(msg.sender);

        // Generate a unique key for storing the request
        bytes32 key = keccak256(abi.encodePacked(index, airline, flight, timestamp));
        oracleResponses[key] = ResponseInfo({
            requester: msg.sender,
            isOpen: true
        });

        emit OracleRequest(index, airline, flight, timestamp);
    }

    // Register an oracle with the contract
    function registerOracle()
        external
        requireIsOperational
        payable
    {
        // Require registration fee
        require(msg.value >= REGISTRATION_FEE, "Registration fee is required");

        uint8[3] memory indexes = generateIndexes(msg.sender);

        oracles[msg.sender] = Oracle({
            isRegistered: true,
            indexes: indexes
        });
    }

    function getMyIndexes()
        view
        external
        returns(uint8[3] memory)
    {
        require(oracles[msg.sender].isRegistered, "Not registered as an oracle");

        return oracles[msg.sender].indexes;
    }

    // Called by oracle when a response is available to an outstanding request
    // For the response to be accepted, there must be a pending request that is open
    // and matches one of the three Indexes randomly assigned to the oracle at the
    // time of registration (i.e. uninvited oracles are not welcome)
    function submitOracleResponse(
        uint8 index,
        address airline,
        string calldata flight,
        uint256 timestamp,
        uint8 statusCode
    )
        external
    {
        require(
            (oracles[msg.sender].indexes[0] == index)
            || (oracles[msg.sender].indexes[1] == index)
            || (oracles[msg.sender].indexes[2] == index),
            "Index does not match oracle request"
        );

        bytes32 key = keccak256(abi.encodePacked(index, airline, flight, timestamp));
        require(
            oracleResponses[key].isOpen,
            "Flight or timestamp do not match oracle request"
        );

        oracleResponses[key].responses[statusCode].push(msg.sender);

        // Information isn't considered verified until at least MIN_RESPONSES
        // oracles respond with the *** same *** information
        emit OracleReport(airline, flight, timestamp, statusCode);
        if (oracleResponses[key].responses[statusCode].length >= MIN_RESPONSES) {

            emit FlightStatusInfo(airline, flight, timestamp, statusCode);

            // stop accepting further responses from oracles
            oracleResponses[key].isOpen = false;

            // Handle flight status as appropriate
            processFlightStatus(key, statusCode);
        }
    }

    function getFlightKey(
        address airline,
        string memory flight,
        uint256 timestamp
    )
        pure
        internal
        returns(bytes32)
    {
        return keccak256(abi.encodePacked(airline, flight, timestamp));
    }

    // Returns array of three non-duplicating integers from 0-9
    function generateIndexes(address account)
        internal
        returns(uint8[3] memory)
    {
        uint8[3] memory indexes;
        indexes[0] = getRandomIndex(account);

        indexes[1] = indexes[0];
        while(indexes[1] == indexes[0]) {
            indexes[1] = getRandomIndex(account);
        }

        indexes[2] = indexes[1];
        while((indexes[2] == indexes[0]) || (indexes[2] == indexes[1])) {
            indexes[2] = getRandomIndex(account);
        }

        return indexes;
    }

    // Returns array of three non-duplicating integers from 0-9
    function getRandomIndex(address account)
        internal
        returns(uint8)
    {
        uint8 maxValue = 10;

        // Pseudo random number...the incrementing nonce adds variation
        uint8 random = uint8(
            uint256(
                keccak256(
                    abi.encodePacked(blockhash(block.number - nonce++), account)
                )
            ) % maxValue
        );

        if (nonce > 250) {
            nonce = 0;  // Can only fetch blockhashes for last 256 blocks so we adapt
        }

        return random;
    }
}


interface FlightSuretyData {
    function authorizeContract(address authorizedContract)
        external;

    function deauthorizeContract(address deauthorizedContract)
        external;

    function setOperatingStatus(bool mode)
        external;

    function registerAirline(address airline)
        external;

    function deregisterAirline(address airline)
        external;

    function isRegisteredAirline(address airline)
        external
        view
        returns(bool);

    function getNumRegisteredAirlines()
        external
        view
        returns(uint256);

    function getAirlineFundingContribution(address airline)
        external
        view
        returns(uint256);

    function registerFlight(
        address airline,
        string calldata flight,
        uint256 timestamp
    )
        external;

    function buyInsurance(
        address airline,
        string calldata flight,
        uint256 timestamp
    )
        external
        payable;

    function isFlightProcessed(bytes32 flightKey)
        external
        view
        returns(bool);

    function creditInsurees(bytes32 flightKey, uint256 mult)
        external;

    function markFlightAsProcessed(bytes32 flightKey)
        external;

    function payInsuree(address payable insuree, uint256 amount)
        external;
}
let Test = require('../config/testConfig.js');
//var BigNumber = require('bignumber.js');
const truffleAssert = require('truffle-assertions');


contract('Oracles', async(accounts) => {

    const TEST_ORACLES_COUNT = 20;
    const ACCOUNTS_START_INDEX = 2;
    const STATUS_CODE_ON_TIME = 10;
    const STATUS_CODE_LATE_AIRLINE = 20;
    const MIN_RESPONSES = 2;
    let config;

    let oracleIndex;
    let flight = 'ND1309';
    let timestamp;

    before('setup contract', async() => {
        config = await Test.Config(accounts);
        timestamp = Math.floor(Date.now() / 1000) + 100000; // future timestamp
        await config.flightSuretyData.fund(
            {from: config.firstAirline, value: web3.utils.toWei("10", "ether")});
    });

    it('can register oracles', async() => {
        let fee = await config.flightSuretyApp.REGISTRATION_FEE.call();

        for (let i=ACCOUNTS_START_INDEX; i<TEST_ORACLES_COUNT; i++) {
            await config.flightSuretyApp.registerOracle({
                from: accounts[i], value: fee});
            let result = await config.flightSuretyApp.getMyIndexes.call({
                from: accounts[i]});
            // console.log(`Oracle Registered: ${result[0]}, ${result[1]}, ${result[2]}`);
        }
    });

    it('can request flight status', async() => {
        // Register a flight to be used for oracle events
        let tx = await config.flightSuretyApp.registerFlight(
            flight, timestamp, {from: config.firstAirline});
        // await truffleAssert.eventEmitted(tx, "FlightRegistered", (ev) => {
        //     return (
        //         ev.airline == config.firstAirline &&
        //         ev.flight == flight &&
        //         ev.timestamp == timestamp &&
        //         ev.flightKey);
        // });
        // truffle-assert can't check for events from non-direct contracts
        // https://ethereum.stackexchange.com/a/61967/10803

        // Submit a request for oracles to get status information for a flight
        tx = await config.flightSuretyApp.fetchFlightStatus(
            config.firstAirline, flight, timestamp);
        await truffleAssert.eventEmitted(tx, "OracleRequest", (ev) => {
            oracleIndex = ev.index.toNumber();
            // console.log("\nOracleRequest event emitted with index", oracleIndex);
            return (
                ev.airline == config.firstAirline &&
                ev.flight == flight &&
                ev.timestamp == timestamp);
        });
    });

    it('can submit on time flight status', async() => {
        let submitted = 0;
        let tx;

        // Since the Index assigned to each test account is opaque by design
        // loop through all the accounts and for each account, all its indices
        // and submit a response. The contract will reject a submission if it was
        // not requested so while sub-optimal, it's a good test of that feature
        for (let i=ACCOUNTS_START_INDEX; i<TEST_ORACLES_COUNT; i++) {

            // Get oracle information
            let oracleIndexes = await config.flightSuretyApp.getMyIndexes.call({
                from: accounts[i]});
            oracleIndexes = oracleIndexes.map(n => n.toNumber());
            // console.log('\n\tOracle Response', accounts[i], oracleIndexes);
            for (let idx=0; idx<3; idx++) {
                // console.log('\tAttempt #' + (idx+1), '-', oracleIndexes[idx], oracleIndexes.includes(oracleIndex));
                if (oracleIndexes.includes(oracleIndex) && submitted < MIN_RESPONSES) {
                    // console.log('\tSubmitting correctly');
                    tx = await config.flightSuretyApp.submitOracleResponse(
                        oracleIndex, config.firstAirline, flight, timestamp,
                        STATUS_CODE_ON_TIME, {from: accounts[i]});
                    submitted++;
                    if (submitted == MIN_RESPONSES) {
                        await truffleAssert.eventEmitted(tx, "OracleReport", (ev) => {
                            return (
                                ev.airline == config.firstAirline &&
                                ev.flight == flight &&
                                ev.timestamp == timestamp &&
                                ev.status == STATUS_CODE_ON_TIME);
                        });
                    }
                    break;
                } else {
                    // console.log('\tSubmitting incorrectly');
                    await truffleAssert.reverts(
                        config.flightSuretyApp.submitOracleResponse(
                            oracleIndexes[idx], config.firstAirline, flight, timestamp,
                            STATUS_CODE_ON_TIME, {from: accounts[i]})
                    );
                }
            }
        }
    });

    it('airline delay results in payouts to insurees', async() => {
        let submitted = 0;
        let tx;
        let newTimestamp = timestamp + 9999;

        // register a flight, purchase insurance for it, request oracles for status
        await config.flightSuretyApp.registerFlight(
            flight, newTimestamp, {from: config.firstAirline});
        let insuredAmount = web3.utils.toWei("1", "ether");
        let insuree = accounts[ACCOUNTS_START_INDEX+TEST_ORACLES_COUNT+1];
        await config.flightSuretyApp.buyInsurance(
            config.firstAirline, flight, newTimestamp,
            {from: insuree, value: insuredAmount});
        tx = await config.flightSuretyApp.fetchFlightStatus(
            config.firstAirline, flight, newTimestamp, {from: insuree});
        await truffleAssert.eventEmitted(tx, "OracleRequest", (ev) => {
            oracleIndex = ev.index.toNumber();
            return (
                ev.airline == config.firstAirline &&
                ev.flight == flight &&
                ev.timestamp == newTimestamp);
        });

        let oracleIndexes;
        // loop through oracles & send airline fault status code as response
        for (let i=ACCOUNTS_START_INDEX; i<TEST_ORACLES_COUNT; i++) {
            oracleIndexes = await config.flightSuretyApp.getMyIndexes.call({
                from: accounts[i]});
            oracleIndexes = oracleIndexes.map(n => n.toNumber());
            if (oracleIndexes.includes(oracleIndex) && submitted < MIN_RESPONSES) {
                tx = await config.flightSuretyApp.submitOracleResponse(
                    oracleIndex, config.firstAirline, flight, newTimestamp,
                    STATUS_CODE_LATE_AIRLINE, {from: accounts[i]});
                submitted++;
                if (submitted == MIN_RESPONSES) {
                    await truffleAssert.eventEmitted(tx, "OracleReport", (ev) => {
                        return (
                            ev.airline == config.firstAirline &&
                            ev.flight == flight &&
                            ev.timestamp == newTimestamp &&
                            ev.status == STATUS_CODE_LATE_AIRLINE);
                    });
                    break;
                }
            }
        }

        // check funds balance & then try withdrawing
        let balBefore = await web3.eth.getBalance(insuree);
        let payout = await config.flightSuretyData.getFundsBalance({from: insuree});
        assert.equal(payout, insuredAmount*1.5, "Incorrect payout funds balance");
        await config.flightSuretyApp.withdraw(payout, {from: insuree});
        let balAfter = await web3.eth.getBalance(insuree);
        // gas cost will reduce exact after balance
        assert.equal(balBefore+payout-balAfter >=0, true, "Incorrect withdrawal");
        payout = await config.flightSuretyData.getFundsBalance({from: insuree});
        assert.equal(payout, web3.utils.toWei("0", "ether"), "Incorrect balance after");
    });
});

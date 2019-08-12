var Test = require('../config/testConfig.js');
var BigNumber = require('bignumber.js');
const truffleAssert = require('truffle-assertions');


contract('Flight Surety Tests', async(accounts) => {

    let config;
    before('setup contract', async() => {
        config = await Test.Config(accounts);
    });

    it(`Deployment initial setup is okay`, async() => {
        let status = await config.flightSuretyData.isOperational.call();
        assert.equal(status, true, "Incorrect initial operating status value");

        status = await config.flightSuretyData.isAuthorizedContract.call(
            config.flightSuretyApp.address);
        assert.equal(status, true,
            "Incorrect initial authorization status of app contract");

        let isRegistered = await config.flightSuretyData.isRegisteredAirline.call(
            config.firstAirline);
        assert.equal(isRegistered, true, "First airline not registered");
        // fund firstAirline
        await config.flightSuretyData.fund(
            {from: config.firstAirline, value: web3.utils.toWei("10", "ether")});
    });

    it(
        `Contract Owner account can authorize and deauthorize app contract`,
        async() => {
            await config.flightSuretyApp.deauthorizeContract(
                config.flightSuretyApp.address, {from: config.owner});
            let authorized = await config.flightSuretyData.isAuthorizedContract.call(
                config.flightSuretyApp.address);
            assert.equal(authorized, false,
                "Owner could not deauthorize app contract");

            await config.flightSuretyData.authorizeContract(
                config.flightSuretyApp.address, {from: config.owner});
            authorized = await config.flightSuretyData.isAuthorizedContract.call(
                config.flightSuretyApp.address);
            assert.equal(authorized, true,
                "Owner could not reauthorize app contract");
    });

    it(
        `can block access to setOperatingStatus() for random account`,
        async() => {
            await truffleAssert.reverts(
                config.flightSuretyApp.setOperatingStatus(
                    false, true, {from: accounts[7]})
            );
    });

    it(
        `block access to functions requireIsOperational when inoperational`,
        async() => {
            await config.flightSuretyApp.setOperatingStatus(
                false, true, {from: config.firstAirline});

            let status = await config.flightSuretyData.isOperational.call();
            assert.equal(status, false, "Incorrect operating status value");

            await truffleAssert.reverts(
                config.flightSuretyApp.registerAirline(
                    accounts[7], {from: config.firstAirline})
            );

            // Set it back for other tests to work
            await config.flightSuretyApp.setOperatingStatus(
                true, true, {from: config.firstAirline});
    });

    it(
        `access to operatingStatus for Contract Owner account / first airline`,
        async() => {
            await truffleAssert.reverts(
                config.flightSuretyData.setOperatingStatus(
                    false, {from: config.owner})
            );

            await config.flightSuretyApp.setOperatingStatus(
                false, true, {from: config.firstAirline});
            let appStatus = await config.flightSuretyApp.isOperational.call();
            let dataStatus = await config.flightSuretyData.isOperational.call();
            assert.equal(appStatus, false,
                "App Operating status could not be set by contract owner");
            assert.equal(dataStatus, false,
                "Data Operating status could not be set by contract owner");

            // Set it back for other tests to work
            await config.flightSuretyApp.setOperatingStatus(
                true, true, {from: config.firstAirline});
            appStatus = await config.flightSuretyApp.isOperational.call();
            dataStatus = await config.flightSuretyData.isOperational.call();
            assert.equal(appStatus, true,
                "App Operating status could not be set back to operational");
            assert.equal(dataStatus, true,
                "Data Operating status could not be set back to operational");

            // only make app contract inoperational
            await config.flightSuretyApp.setOperatingStatus(
                false, false, {from: config.firstAirline});
            appStatus = await config.flightSuretyApp.isOperational.call();
            dataStatus = await config.flightSuretyData.isOperational.call();
            assert.equal(appStatus, false,
                "App could not be made inoperational by contract owner");
            assert.equal(dataStatus, true,
                "Data contract status incorrectly set to inoperational");

            // Set it back for other tests to work
            await config.flightSuretyApp.setOperatingStatus(
                true, false, {from: config.firstAirline});
            appStatus = await config.flightSuretyApp.isOperational.call();
            dataStatus = await config.flightSuretyData.isOperational.call();
            assert.equal(appStatus, true,
                "App could not be made operational by contract owner");
            assert.equal(dataStatus, true,
                "Data contract status incorrectly set to inoperational - 2");
    });

    it(
        '(airline) directly registerAirline from funded airline (less than 4)',
        async() => {
            let secondAirline = accounts[2];
            let newAirline = accounts[3];

            await config.flightSuretyApp.registerAirline(
                secondAirline, {from: config.firstAirline});

            await truffleAssert.reverts(
                config.flightSuretyApp.registerAirline(
                    newAirline, {from: secondAirline})
            );
            let result = await config.flightSuretyData.isRegisteredAirline.call(
                newAirline);
            assert.equal(result, false,
                "Can't register another airline if caller hasn't provided funding");

            result = await config.flightSuretyData.getAirlineFundingContribution.call(
                secondAirline);
            assert.equal(
                web3.utils.fromWei(result), '0', "Funding inconsistency");

            // try funding with less amount
            await config.flightSuretyData.fund(
                {from: secondAirline, value: web3.utils.toWei("1", "ether")});
            await truffleAssert.reverts(
                config.flightSuretyApp.registerAirline(
                    newAirline, {from: secondAirline})
            );
            result = await config.flightSuretyData.isRegisteredAirline.call(
                newAirline);
            assert.equal(result, false,
                "Can't register another airline with inadequate funding");

            result = await config.flightSuretyData.getAirlineFundingContribution.call(
                secondAirline);
            assert.equal(
                web3.utils.fromWei(result), '1', "Funding inconsistency");

            await config.flightSuretyData.fund(
                {from: secondAirline, value: web3.utils.toWei("9", "ether")});
            result = await config.flightSuretyData.getAirlineFundingContribution.call(
                secondAirline);
            assert.equal(
                web3.utils.fromWei(result), '10', "Funding inconsistency");

            await config.flightSuretyApp.registerAirline(
                newAirline, {from: secondAirline});
            result = await config.flightSuretyData.isRegisteredAirline.call(
                newAirline);
            assert.equal(
                result, true, "Can register another airline with adequate funding");

            // fund 3rd airline
            await config.flightSuretyData.fund(
                {from: newAirline, value: web3.utils.toWei("10", "ether")});
    });

    it(
        '(airline) multiparty airline registration once registered airlines > 4',
        async() => {
            let fourthAirline = accounts[4];

            await config.flightSuretyApp.registerAirline(
                fourthAirline, {from: config.firstAirline});
            await config.flightSuretyData.fund(
                {from: fourthAirline, value: web3.utils.toWei("10", "ether")});
            // confirm that this was without the multiparty
            let result = await config.flightSuretyData.isRegisteredAirline.call(
                fourthAirline);
            assert.equal(result, true, "Fourth airline should be directly registered");
            // fund the airline
            await config.flightSuretyData.fund(
                {from: fourthAirline, value: web3.utils.toWei("10", "ether")});

            let num = await config.flightSuretyData.getNumRegisteredAirlines.call();
            assert.equal(num, 4, "4 airlines should be registered, not "+num);

            // test 5th registration to be only after multiparty consensus
            let fifthAirline = accounts[5];
            await config.flightSuretyApp.registerAirline(
                fifthAirline, {from: config.firstAirline});
            result = await config.flightSuretyData.isRegisteredAirline.call(
                fifthAirline);
            assert.equal(result, false, "Fifth airline needs 1 more vote");
            await config.flightSuretyApp.registerAirline(
                fifthAirline, {from: fourthAirline});
            result = await config.flightSuretyData.isRegisteredAirline.call(
                fifthAirline);
            assert.equal(result, true, "Fifth airline needs only 2 votes");

            num = await config.flightSuretyData.getNumRegisteredAirlines.call();
            assert.equal(num, 5, "5 airlines should be registered, not "+num);
    });
});

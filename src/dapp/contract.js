import FlightSuretyApp from '../../build/contracts/FlightSuretyApp.json';
import FlightSuretyData from '../../build/contracts/FlightSuretyData.json';
import Config from './config.json';
import Web3 from 'web3';

export default class Contract {
    constructor(network, callback) {
        let config = Config[network];
        this.web3 = new Web3(new Web3.providers.HttpProvider(config.url));
        this.flightSuretyApp = new this.web3.eth.Contract(FlightSuretyApp.abi, config.appAddress);
        this.flightSuretyData = new this.web3.eth.Contract(FlightSuretyData.abi, config.dataAddress);
        this.initialize(callback);
        this.owner = null;
        this.airlines = [];
        this.flights = [];
        this.gasPrice = this.web3.utils.toWei("10", "gwei");
        this.gas = 6700000;
    }

    initialize(callback) {
        let self = this;
        self.web3.eth.getAccounts((error, accts) => {
            self.owner = accts[0];
            self.airlines.push(accts[1]);

            callback();
        });
    }

    isOperational(callback) {
        let self = this;
        self.flightSuretyApp.methods
            .isOperational()
            .call({from: self.owner}, callback);
    }

    registerAirline(airline, fromAirline, callback) {
        let self = this;
        let payload = {airline: airline, fromAirline: fromAirline}
        self.flightSuretyApp.methods
            .registerAirline(payload.airline)
            .send({from: payload.fromAirline, gas: self.gas, gasPrice: self.gasPrice},
                (error, result) => {callback(error, payload);});
    }

    fundAirline(airline, amount, callback) {
        let self = this;
        amount = self.web3.utils.toWei(amount);
        let payload = {airline: airline, amount: amount}
        self.flightSuretyData.methods
            .fund()
            .send({from: payload.airline, value: payload.amount, gas: self.gas,
                   gasPrice: self.gasPrice},
                (error, result) => {callback(error, payload);});
    }

    registerFlight(airline, flight, timestamp, callback) {
        let self = this;
        let payload = {
            airline: airline,
            flight: flight,
            timestamp: timestamp,
        }
        self.flightSuretyApp.methods
            .registerFlight(payload.flight, payload.timestamp)
            .send({from: payload.airline, gas: self.gas, gasPrice: self.gasPrice},
                (error, result) => {callback(error, payload);});
    }

    fetchFlightStatus(airline, flight, timestamp, callback) {
        let self = this;
        let payload = {
            airline: airline,
            flight: flight,
            timestamp: timestamp,
        }
        self.flightSuretyApp.methods
            .fetchFlightStatus(payload.airline, payload.flight, payload.timestamp)
            .send({from: self.owner}, (error, result) => {
                callback(error, payload);
            });
    }
}

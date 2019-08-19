const gas = 6700000;

class Oracle {
    constructor(account) {
        this.account = account;
        this.indexes = [];
        this.isListening = false;
    }

    listen(contract, fee, callback) {
        let self = this;
        self.registerOracle(contract, fee, () => {
            self.updateIndexes(contract, () => {
                callback();
                console.log(self.account, 'registered oracle');
            });
        });
    }

    registerOracle(contract, fee, callback) {
        let self = this;
        contract.methods.registerOracle()
            .send({from: self.account, value: fee, gas: gas}, callback);
    }

    updateIndexes(contract, callback) {
        let self = this;
        contract.methods.getMyIndexes()
            .call({from: self.account}, (error, returnValues) => {
                if (error) {
                    console.log(error);
                    return;
                }
                self.indexes = returnValues;
                self.isListening = true;
                console.log(self.account, 'updated oracle indexes', returnValues);
                callback();
                self.subscribeRequestEvent(contract);
            });
    }

    subscribeRequestEvent(contract) {
        let self = this;
        contract.events.OracleRequest({fromBlock: 0}, (error, event) => {
            if (error) {
                console.log(error);
                return;
            }

            if (self.indexes.includes(event.returnValues.index)) {
                self.submitResponse(contract, event);
            }
        });
    }

    submitResponse(contract, event) {
        let self = this;
        const index = event.returnValues.index;
        const airline = event.returnValues.airline;
        const flight = event.returnValues.flight;
        const timestamp = event.returnValues.timestamp.toNumber();
        let randInt = Math.random() * (50 - 10) + 10;
        const statusCode = randInt - randInt % 10;

        contract.methods.submitOracleResponse(
            index, airline, flight, timestamp, statusCode
        ).send({from: self.account, gas: gas}, () => {
            console.log('submitted oracle response ' + statusCode);
        });
    }
}

module.exports = Oracle;

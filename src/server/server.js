import FlightSuretyApp from '../../build/contracts/FlightSuretyApp.json';
import Config from './config.json';
import Web3 from 'web3';
import express from 'express';
import Oracle from './oracle';


const oracles = [];

let config = Config['localhost'];
let web3 = new Web3(new Web3.providers.WebsocketProvider(config.url.replace('http',
'ws')));

async function init() {
    let accounts = await web3.eth.getAccounts();
    web3.eth.defaultAccount = accounts[0];
    let flightSuretyApp = new web3.eth.Contract(FlightSuretyApp.abi, config.appAddress);

    flightSuretyApp.events.OracleRequest({fromBlock: 0}, (error, event) => {
        if (error) console.log(error);
        console.log(event);
    });

    // deploy 20 listening oracles
    accounts.slice(10, 30).forEach((account) => {
        const oracle = new Oracle(account);
        oracle.listen(flightSuretyApp, web3.utils.toWei('1', 'ether'), () => {
            oracles.push(oracle);
        });
    });
}

init();

const app = express();
app.get('/', (req, res) => {
    const active = oracles.filter(oracle => oracle.isListening);
    const inactive = oracles.filter(oracle => !oracle.isListening);
    res.send({
        'Total Oracles': oracles.length,
        'Active Count': active.length,
        'Inactive Count': inactive.length,
        'Active Oracles': active,
        'Inactive Oracles': inactive,
    });
})

export default app;

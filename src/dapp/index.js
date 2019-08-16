import DOM from './dom';
import Contract from './contract';
import './flightsurety.css';


(async() => {

    let result = null;
    let airlineSelectIDs = [
        'register-airline-from-airline',
        'register-flight-airline',
        'fund-airline',
        'submit-oracle-airline',
    ];
    let flightSelectIDs = [
        'submit-oracle-number',
    ];

    let contract = new Contract('localhost', () => {
        function toggleContainer(on, off) {
            $('#li-'+on+'-container').addClass('active');
            $('#li-'+off+'-container').removeClass('active');
            $('#'+on+'-container').show();
            $('#'+off+'-container').hide();
        }
        DOM.elid('switch-to-passenger-container').addEventListener('click', () => {
            toggleContainer('passenger', 'airline');
        });
        DOM.elid('switch-to-airline-container').addEventListener('click', () => {
            toggleContainer('airline', 'passenger');
        });

        contract.isOperational((error, result) => {
            display('Operational Status', [{
                    label: 'Operational Status',
                    error: error,
                    value: result
                }]);
        });

        contract.airlines.map((airline) => {
            addOption(airline, airlineSelectIDs);
        });

        DOM.elid('is-registered-airline').addEventListener('click', () => {
            let airline = DOM.elid('is-registered-airline-airline').value;

            contract.isRegisteredAirline(airline, (error, result) => {
                display('Airline Registration', [{
                    label: 'Registration Status',
                    error: error,
                    value: result,
                }]);
            });
        });

        DOM.elid('funding-status-airline').addEventListener('click', () => {
            let airline = DOM.elid('is-registered-airline-airline').value;

            contract.getAirlineFundingContribution(airline, (error, result) => {
                display('Airline Funding', [{
                    label: 'Funding Amount',
                    error: error,
                    value: contract.web3.utils.fromWei(String(result), 'ether') + ' ether',
                }]);
            });
        });

        DOM.elid('register-airline').addEventListener('click', () => {
            let fromAirline = DOM.elid('register-airline-from-airline').value;
            let airline = DOM.elid('register-airline-airline').value;

            contract.registerAirline(airline, fromAirline, (error, result) => {
                display('Register Airline', [{
                    label: 'Register Airline',
                    error: error,
                    value: result.airline + ' (' + result.fromAirline + ')',
                }]);
                if (!error)
                    addOption(result.airline, airlineSelectIDs);
            });
        });

        DOM.elid('fund').addEventListener('click', () => {
            let airline = DOM.elid('fund-airline').value;
            let amount = DOM.elid('fund-amount').value;

            contract.fundAirline(airline, amount, (error, result) => {
                display('Fund Airline', [{
                    label: 'Fund Airline',
                    error: error,
                    value: result.airline,
                }]);
            });
        });

        DOM.elid('register-flight').addEventListener('click', () => {
            let airline = DOM.elid('register-flight-airline').value;
            let flight = DOM.elid('register-flight-number').value;
            let timestamp = DOM.elid('register-flight-timestamp').value;

            contract.registerFlight(airline, flight, timestamp, (error, result) => {
                let val = result.flight + ' ;; ' + result.timestamp;
                display('Flight Registration', [{
                    label: 'Fetch Flight Status',
                    error: error,
                    value: result.airline + ' - ' + val,
                }]);
                if (!error)
                    addOption(val, flightSelectIDs);
            });
        });

        DOM.elid('submit-oracle').addEventListener('click', () => {
            let airline = DOM.elid('submit-oracle-airline').value;
            let flight = DOM.elid('submit-oracle-number').value.split(" ;; ")[0];
            let timestamp = DOM.elid('submit-oracle-number').value.split(" ;; ")[1];

            contract.fetchFlightStatus(airline, flight, timestamp, (error, result) => {
                display('Oracles', [{
                    label: 'Fetch Flight Status',
                    error: error,
                    value: result.airline + ' ' + result.flight + ' ' + result.timestamp,
                }]);
            });
        });

    });

})();


function display(title, results) {
    let displayDiv = DOM.elid("display-wrapper");
    let section = DOM.section();
    section.appendChild(DOM.h4(title));
    results.map((result) => {
        let row = section.appendChild(DOM.div({className: 'row'}));
        row.appendChild(
            DOM.div({className: 'col text-left field'}, result.label + ' :'));
        row.appendChild(
            DOM.div({
                className: 'col text-left field-value'},
                result.error ? String(result.error) : String(result.value)));
        section.appendChild(row);
    })
    section.appendChild(DOM.hr());
    displayDiv.prepend(section);
}


function addOption(optionValue, selectIDs, ...args) {
    selectIDs.map((selectID) => {
        let sel = DOM.elid(selectID);
        sel.appendChild(
            DOM.option({value: String(optionValue), ...args}, String(optionValue)));
    });
}


function removeOption(optionValue, selectIDs) {
    selectIDs.map((selectID) => {
        let sel = DOM.elid(selectID);
        for (var i=0; i<sel.length; i++) {
            if (sel.options[i].value == optionValue)
                sel.remove(i);
        }
    });
}

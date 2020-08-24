const ethers = require('ethers');
const Web3 = require('web3');
const abi = require('./abi');

const token = process.env.INFURA_TOKEN;
const providerUrl = 'https://ropsten.infura.io/v3/' + '15a82b43433b481ea733e751da927335';
const web3 = new Web3(providerUrl);

const safeAddress = '0x5884247db6a36b9ba4f655bbe960b17ba8d8e06f';
const safeAbi = abi.GnosisSafe;
const safeContract = new web3.eth.Contract(safeAbi, safeAddress);

const getOwners = async () => {
    try {
        const owners = await safeContract.methods.getOwners().call();
        console.log(owners);
    } catch (e) {
        console.error(e);
    }
};

getOwners();

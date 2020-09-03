const ethers = require('ethers');
const Web3 = require('web3');
const abi = require('./abi');

const token = process.env.INFURA_TOKEN;
const providerUrl = 'https://mainnet.infura.io/v3/' + '15a82b43433b481ea733e751da927335';
const web3 = new Web3(providerUrl);

const safeAddress = '0x22744aaa725852c2c72a59c240a3677db39cf8d3';
const safeAbi = abi.GnosisSafe;
const safeContract = new web3.eth.Contract(safeAbi, safeAddress);

const getOwners = async () => {
    try {
        const owners = await safeContract.methods.getOwners().call();
        console.log(owners);

        const threshold = await safeContract.methods.getThreshold().call();
        console.log(threshold);
    } catch (e) {
        console.error(e);
    }
};

getOwners();

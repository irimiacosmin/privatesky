//command line script
//the first argument is a path to a configuration file


//var config = require("util/configLoader.js")(process.args[1]);
const fs = require("fs");
const path = require("path");
const $$ = require('./core');

let spaceName = "self";

//---------------------------- ARGS pre-processing -----------------------------
let argv;
if (process.argv.length < 3) {
	console.log("Failed send args to sandbox process");
	return;
} else {
	argv = process.argv[2].split(",");
}

if (argv.length < 1 || argv[0] === "") {
	console.log("Failed to start sandbox with a space name");
	return;
} else {
	spaceName = argv[0];
}

if (argv.length < 2) {
	console.log("Failed to find root folder of installation into args. \nUsing default PRIVATESKY_ROOT_FOLDER value");
}
pskRootFolder = argv[1] || process.env.PRIVATESKY_ROOT_FOLDER;

//---------------------------- ARGS pre-processing -----------------------------

var oldLog = console.log;
console.log = function(...args){
	oldLog.apply(this, ["["+spaceName+"]"].concat(args));
}

console.log("pskRootFolder", pskRootFolder);

console.log("Booting sandbox:", spaceName);

//TODO
// ??? why we need this? what changed?
process.chdir(path.join(process.env.PRIVATESKY_TMP, "sandboxes", spaceName));

/*

Once everything it is tied done deployer needs to be run in order to get more dependencies ready for the sandbox

var deployer = require("./../deployer/Deployer.js");
//a minimal config example
var config = {
	"domain": spaceName,
	"modules": ["soundpubsub", "virtualmq"],
	"libraries": ["core", "crl"]
};

deployer.runBasicConfig(pskRootFolder, config, function (error, result) {
	if(error){
		console.log("[Sandbox Deployer - Error]", error);
	}else{
		console.log("[Sandbox Deployer - Result]", result);
	}
});*/

function isPathToOwnAgentSpace(pathToTest) {
	if (!pathToTest || pathToTest === '') {
		return false;
	}

	pathToTest = path.normalize(pathToTest);
	pathToTest = path.resolve(pathToTest);

	return pathToTest.startsWith(process.cwd());
}

function isPathToOwnAgentMqOutbound(pathToTest) {
	if (!pathToTest || pathToTest === '') {
		return false;
	}

	pathToTest = path.normalize(pathToTest);
	pathToTest = path.resolve(pathToTest);

	return pathToTest.startsWith(path.join(process.cwd(), 'mq', 'outbound'));
}

function isPathToOwnAgentMqInbound(pathToTest) {
	if (!pathToTest || pathToTest === '') {
		return false;
	}

	pathToTest = path.normalize(pathToTest);
	pathToTest = path.resolve(pathToTest);

	return pathToTest.startsWith(path.join(process.cwd(), 'mq', 'inbound'));
}

function isPathToOwnAgentMqFolders(originPath, destinationPath) {
	if (!originPath || !destinationPath || originPath === '' || destinationPath === '') {
		return false;
	}

	originPath = path.normalize(originPath);
	originPath = path.resolve(originPath);

	destinationPath = path.normalize(destinationPath);
	destinationPath = path.resolve(destinationPath);

	const inboundPath  = path.join(process.cwd(), 'mq', 'inbound', path.sep);
	const outboundPath = path.join(process.cwd(), 'mq', 'outbound', path.sep);

	const isInboundPath  = (originPath.startsWith(inboundPath) && destinationPath.startsWith(inboundPath));
	const isOutboundPath = (originPath.startsWith(outboundPath) && destinationPath.startsWith(outboundPath));

	return isInboundPath || isOutboundPath;
}

const fsProxyHandler = {
	get(target, prop) {
		const self = this;

		return function (...params) {
			if (self.allowedMethods.includes(prop)) {
				for (const validatorDefinition of self.customValidatorsDefinition[prop]) {

					const paramsToPass = [];
					for (const position of validatorDefinition.argumentsPositionsToValidate) {
						paramsToPass.push(params[position])
					}

					if (!validatorDefinition.validator(...paramsToPass)) {
						throw new Error(`sandbox tried running method ${prop} with illegal arguments ${paramsToPass}`);
					}
				}
				return target[prop](...params);
			} else {
				console.warn('sandbox tried accessing unallowed or inexistent property', prop);
			}
		}
	}
};

Object.defineProperty(fsProxyHandler, 'customValidatorsDefinition', {
	value: Object.freeze({
		mkdir: [{argumentsPositionsToValidate: [0], validator: isPathToOwnAgentSpace}],
		exists: [{argumentsPositionsToValidate: [0], validator: isPathToOwnAgentSpace}],
		existsSync: [{argumentsPositionsToValidate: [0], validator: isPathToOwnAgentSpace}],
		unlink: [{argumentsPositionsToValidate: [0], validator: isPathToOwnAgentSpace}],
		readFile: [{argumentsPositionsToValidate: [0], validator: isPathToOwnAgentSpace}],
		readdir: [{argumentsPositionsToValidate: [0], validator: isPathToOwnAgentSpace}],
		readdirSync: [{argumentsPositionsToValidate: [0], validator: isPathToOwnAgentSpace}],
		writeFile: [{argumentsPositionsToValidate: [0], validator: isPathToOwnAgentMqOutbound}],
		writeFileSync: [{argumentsPositionsToValidate: [0], validator: isPathToOwnAgentMqOutbound}],
		rename: [{argumentsPositionsToValidate: [0, 1], validator: isPathToOwnAgentMqFolders}],
		watch: [{argumentsPositionsToValidate: [0], validator: isPathToOwnAgentMqInbound}]
	})
});


Object.defineProperty(fsProxyHandler, 'allowedMethods', {
	value: Object.freeze(Object.keys(fsProxyHandler.customValidatorsDefinition))
});

const fsProxy = new Proxy(fs, fsProxyHandler);
const VM = require("../modules/vm2").NodeVM;

const vm = new VM({
	require: {
		external: true,
		builtin: ['path', 'util', 'crypto', 'child_process'],
		root: process.cwd(), // needs further tests
		context: 'sandbox',
		mock: {
			fs: fsProxy/*,
			whys: require('whys')*/
		}
	},
	sandbox: {
		process: {
			env: {}, // needed for RUN_WITH_WHYS
			cwd: function(){
				return process.cwd()
			}
		}
	},
	wrapper: 'none'
});

vm.run(`
        'strict mode';
        // console.error('entering sandbox');
        require('./code/engine/core.js');

		$$.requireModule("callflow").swarmInstanceManager;
        
        const sand = require('./code/engine/pubSub/sandboxPubSub');
        
        global.$$.PSK_PubSub = sand.create(__dirname);

        $$.loadLibrary('testSwarms', 'code/libraries/testSwarms');
		
		console.log("Sandbox [${spaceName}] is running and waiting for swarms.");
`, process.cwd() + "/test.js");
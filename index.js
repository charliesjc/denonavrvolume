'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var heos = require('heos-api')
var net = require('net')

var denonDevices = [];
var singleDevice = [];
const port = 23;
var host;

module.exports = denonAvrVolumeControl;
function denonAvrVolumeControl(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;

}

denonAvrVolumeControl.prototype.onVolumioStart = function () {
	var self = this;
	var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

	// Tack onto the saveVolumeOptions method to ensure we can setup/cleanup on a mixer change
	this.commandRouter.sharedVars.registerCallback('alsa.outputdevicemixer', this.setupHeosAndIdDevices.bind(this));

	return libQ.resolve();
}

denonAvrVolumeControl.prototype.onStart = function () {
	var self = this;
	var defer = libQ.defer();

	//Setup the plugin to do its thing
	self.setupHeosAndIdDevices()
		.then(() => defer.resolve());

	// Once the Plugin has successfull started resolve the promise


	return defer.promise;
};

denonAvrVolumeControl.prototype.onStop = function () {
	var self = this;
	var defer = libQ.defer();

	// Once the Plugin has successfull stopped resolve the promise
	defer.resolve();

	return libQ.resolve();
};

denonAvrVolumeControl.prototype.onRestart = function () {
	var self = this;
	var defer = libQ.defer();
	//Setup the plugin to do its thing
	self.setupHeosAndIdDevices()
		.then(() => defer.resolve());

	return defer.promise;
};


// Configuration Methods -----------------------------------------------------------------------------

denonAvrVolumeControl.prototype.getUIConfig = function () {
	var defer = libQ.defer();
	var self = this;

	var lang_code = this.commandRouter.sharedVars.get('language_code');

	self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
		__dirname + '/i18n/strings_en.json',
		__dirname + '/UIConfig.json')
		.then(function (uiconf) {


			defer.resolve(uiconf);
		})
		.fail(function () {
			defer.reject(new Error());
		});

	return defer.promise;
};

denonAvrVolumeControl.prototype.getConfigurationFiles = function () {
	return ['config.json'];
}

denonAvrVolumeControl.prototype.setUIConfig = function (data) {
	var self = this;
	//Perform your installation tasks here
};

denonAvrVolumeControl.prototype.getConf = function (varName) {
	var self = this;
	//Perform your installation tasks here
};

denonAvrVolumeControl.prototype.setConf = function (varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};

denonAvrVolumeControl.prototype.setupHeosAndIdDevices = function () {
	var self = this;
	var defer = libQ.defer();

	if (this.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getConfigParam', 'mixer_type') == 'None') {
		//Set everything up and allow the volume to be changed. We only want to be messing with the volume if nothing else is.
		denonDevices = [];
		var denonDevice = new net.Socket();

		heos.discoverAndConnect().then(connection => {
			connection
				.on({ commandGroup: 'player', command: 'get_players' }, (players) => {
					if (players.payload) {
						players.payload.forEach(player => {
							if (player.model && player.model.toLowerCase().includes('denon avr')) denonDevices.push([player.model, player.ip])
						});
						singleDevice = denonDevices ? denonDevices[0] : [];

						if (singleDevice) {
							host = singleDevice[1];
							// self.logger.info(`Denon AVR Volume Control::Device found: ${singleDevice[0]} with IP address: ${singleDevice[1]}`);
							denonDevice.connect(port, host, function () {
								self.logger.info(`Denon AVR Volume Control::Connected to ${singleDevice[0]} on ${host}`);
								// defer.resolve();

								// denonDevice.write('MV?');

							});

							denonDevice.on('data', function (data) {
								self.logger.debug(`Denon AVR Volume Control:: ${data}`);
								if (data.includes('MV') && !data.includes('MVMAX')) {
									self.logger.info(`Denon AVR Volume Control::Current volume is: ${data.toString().replace('MV', '')}`);
								}
							});

							denonDevice.on('close', function () {
								self.logger.info('Denon AVR Volume Control::Connection Closed');
							});

							denonDevice.on('error', function (error) {
								self.logger.error(`Denon AVR Volume Control::Connection Error ${error}`);
								defer.reject(error)
							});
						}
					}

				})
				.onAll((message) => self.logger.info(`Denon AVR Volume Control::${JSON.stringify(message, null, ' ')}`)) // Change later to debug message
				.write('system', 'register_for_change_events', { enable: 'off' })
				.write('player', 'get_players', {})
			// .write('system', 'register_for_change_events', { enable: 'on' })

			defer.resolve()
		})
			.catch((e) => {
				self.logger.error(`Denon AVR Volume Control::${e}`);
				defer.reject(`Denon AVR Volume Control::${e}`);
			})

	}

	return defer.promise;

}


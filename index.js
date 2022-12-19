'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var heos = require('heos-api')
var net = require('net')
const Denon = require('node-denon-client');
const { VolumeOptions, MuteOptions } = require('node-denon-client/lib/options');

var denonDevices = [];
var singleDevice = [];
var activeDevice;
const port = 23;
var host;
var volumeSettings = {
	maxvolume: '98',
	volumecurve: 'linear',
	volumesteps: 1,
	volumeOverride: true
};
var currentVolume;
var currentMute;

var Volume = {
	vol: null,
	mute: null,
	disableVolumeControl: false
};


module.exports = denonAvrVolumeControl;
function denonAvrVolumeControl(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;



	denonAvrVolumeControl.prototype.onVolumioStart = function () {
		var self = this;
		var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
		this.config = new (require('v-conf'))();
		this.config.loadFile(configFile);

		// Tack onto the outputdevicemixer method to ensure we can setup/cleanup on a mixer change
		this.commandRouter.sharedVars.registerCallback('alsa.outputdevicemixer', this.setupHeosAndIdDevices.bind(this));

		return libQ.resolve();
	}

	denonAvrVolumeControl.prototype.onStart = function () {
		var self = this;
		var defer = libQ.defer();

		//Setup the plugin to do its thing
		self.setupHeosAndIdDevices();

		defer.resolve();

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
		self.setupHeosAndIdDevices();

		defer.resolve();

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
				if (denonDevices) {
					denonDevices.forEach(device => {
						self.configManager.pushUIConfigParam(uiconf, 'sections[0].content[0].options', {
							value: device.ip,
							label: `${device.name} - ${device.model}`
						});
					});
				} else {
					self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].options', { value: 0, label: 'No receivers detected' });
					self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value', { value: 0, label: 'No receivers detected' });

				}

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

			heos.discoverAndConnect().then(connection => {
				connection
					.on({ commandGroup: 'player', command: 'get_players' }, (players) => {
						if (players.payload) {

							denonDevices = [];

							players.payload.forEach(player => {
								if (player.model && player.model.toLowerCase().includes('denon avr')) denonDevices.push(player)
							});
							singleDevice = denonDevices ? denonDevices[0] : [];

							if (singleDevice) {
								self.connectToAvr();

							}
						}

					})
					.onAll((message) => self.logger.verbose(`Denon AVR Volume Control::${JSON.stringify(message, null, ' ')}`)) // Change later to debug message
					.write('system', 'register_for_change_events', { enable: 'off' })
					.write('player', 'get_players', {})
				// .write('system', 'register_for_change_events', { enable: 'on' })

			})
				.catch((e) => {
					self.logger.error(`Denon AVR Volume Control::${e}`);

				})

		}

		return defer.resolve();

	}

	denonAvrVolumeControl.prototype.connectToAvr = function () {
		var self = this;
		var defer = libQ.defer();

		if (activeDevice) activeDevice.disconnect();
		activeDevice = undefined;

		host = singleDevice.ip;

		activeDevice = new Denon.DenonClient(host);

		// Subscribe to volume changes
		activeDevice.on('masterVolumeChanged', (volume) => {
			// This event will fire every time when the volume changes.
			// Including non requested volume changes (Using a remote, using the volume wheel on the device).
			Volume.vol = (volume >= 0 && volume <= 98) ? volume : Volume.vol;
			self.commandRouter.volumioupdatevolume(Volume);
			self.logger.info(`Denon AVR Volume Control::Current volume is: ${Volume.vol}`);

		});

		activeDevice.on('masterVolumeMaxChanged', (maxvolume) => {

			volumeSettings.maxvolume = (maxvolume >= 0 && maxvolume <= 98) ? maxvolume : volumeSettings.maxvolume;
			self.logger.info(`Denon AVR Volume Control::Maximum volume allowed is: ${volumeSettings.maxvolume}`);

		});

		activeDevice.on('close', () => {
			// self.setVolumeOverride(false);
		});

		// Make it happen
		activeDevice.connect().then(() => {
			self.logger.info(`Denon AVR Volume Control::Connected to ${singleDevice[0]} on ${host}`);

			// Get output card number
			let outputdevice = self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getConfigParam', 'outputdevice');

			// Override the volume control using the built-in method
			self.setVolumeOverride({
				card: outputdevice, pluginType: 'system_hardware', pluginName: 'denon_avr_volume_control', overrideAvoidSoftwareMixer: true
			});

			defer.resolve();

		}).then(() => {
			return activeDevice.getVolume(); // Get the initial volume to update the UI.
		})
			.catch((error) => {
				// Oh noez.
				self.logger.error(`Denon AVR Volume Control::${error}`);
				defer.reject();
			});



		return defer.promise;
	}

	self.setVolumeOverride = function (data) {
		var self = this;

		// Override the volume control using the built-in method
		return self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'setDeviceVolumeOverride', data);
	}

	denonAvrVolumeControl.prototype.updateVolumeSettings = function (data) {
		var self = this;
		var defer = libQ.defer();

		// self.logger.error(`AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA: ${JSON.stringify(data, null, ' ')}`);

		// volumeSettings = { 
		// 	device: valdevice,
		//   name: outdevicename,
		//   mixer: valmixer,
		//   mixertype: valmixertype,
		//   maxvolume: valvolumemax,
		//   volumecurve: valvolumecurvemode,
		//   volumestart: valvolumestart,
		//   volumesteps: valvolumesteps,
		//   volumeOverride: false 
		// }

		defer.resolve(data);
		return defer.promise;
	}

	denonAvrVolumeControl.prototype.retrievevolume = function () {
		var self = this;
		var defer = libQ.defer();

		libQ.resolve(Volume)
			.then(function (Volume) {
				defer.resolve(Volume);
				self.commandRouter.volumioupdatevolume(Volume);
			});


		return defer.promise;
	}

	denonAvrVolumeControl.prototype.alsavolume = function (VolumeInteger) {
		var self = this;
		var defer = libQ.defer();

		self.logger.info('denonAvrVolumeControl::SetAlsaVolume ' + VolumeInteger);

		switch (VolumeInteger) {
			case 'mute':
				// Mute
				activeDevice.setMute(MuteOptions.On).then(() => {
					Volume.mute = true;
					Volume.disableVolumeControl = false;
					defer.resolve(Volume);
				});

				break;
			case 'unmute':
				// Unmute
				activeDevice.setMute(MuteOptions.Off).then(() => {
					Volume.mute = false;
					Volume.disableVolumeControl = false;
					defer.resolve(Volume);
				});

				break;
			case 'toggle':
				// Mute or unmute, depending on current state
				if (Volume.mute) {
					defer.resolve(self.alsavolume('unmute'));
				} else {
					defer.resolve(self.alsavolume('mute'));
				}
				break;
			case '+':
				VolumeInteger = Number(Volume.vol) + Number(volumeSettings.volumesteps);
				if (VolumeInteger > 98) {
					VolumeInteger = 98;
				}
				if (VolumeInteger > volumeSettings.maxvolume) {
					VolumeInteger = volumeSettings.maxvolume;
				}
				Volume.vol = VolumeInteger;
				Volume.mute = false;
				Volume.disableVolumeControl = false;
				activeDevice.setVolume(Volume.vol).then(() => {
					defer.resolve(Volume);
				});

				break;
			case '-':
				VolumeInteger = Number(Volume.vol) - Number(volumeSettings.volumesteps);
				if (VolumeInteger < 0) {
					VolumeInteger = 0;
				}
				if (VolumeInteger > volumeSettings.maxvolume) {
					VolumeInteger = volumeSettings.maxvolume;
				}
				Volume.vol = VolumeInteger;
				Volume.mute = false;
				Volume.disableVolumeControl = false;
				activeDevice.setVolume(Volume.vol).then(() => {
					defer.resolve(Volume);
				});

				break;
			default:
				// Set the volume with numeric value 0-98
				if (VolumeInteger < 0) {
					VolumeInteger = 0;
				}
				if (VolumeInteger > 98) {
					VolumeInteger = 98;
				}
				if (VolumeInteger > volumeSettings.maxvolume) {
					VolumeInteger = volumeSettings.maxvolume;
				}

				Volume.vol = VolumeInteger;
				Volume.mute = false;
				Volume.disableVolumeControl = false;
				activeDevice.setVolume(Volume.vol).then(() => {
					defer.resolve(Volume);
				});
		}

		return defer.promise;

	}
}
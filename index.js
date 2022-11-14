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
		if (activeDevice) activeDevice.end();
		activeDevice = undefined;
		denonDevices = [];

		if (this.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getConfigParam', 'mixer_type') == 'None') {
			//Set everything up and allow the volume to be changed. We only want to be messing with the volume if nothing else is.

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
								activeDevice = new net.Socket();
								activeDevice.connect(port, host, function () {
									self.logger.info(`Denon AVR Volume Control::Connected to ${singleDevice[0]} on ${host}`);
									self.sendCommand('MV?');

									// activeDevice.write('MV?');

								});

								activeDevice.on('data', function (data) {
									self.logger.debug(`Denon AVR Volume Control:: ${data}`);
									self.decodeVolume(data);
								});

								activeDevice.on('close', function () {
									self.logger.info('Denon AVR Volume Control::Connection Closed');
								});

								activeDevice.on('error', function (error) {
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

				// Get output card number
				let outputdevice = self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getConfigParam', 'outputdevice');

				// Override the volume control using the built-in method
				self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'setDeviceVolumeOverride', {
					card: outputdevice, pluginType: 'audio_interface', pluginName: 'denon_avr_volume_control', overrideAvoidSoftwareMixer: true
				});

				defer.resolve();

			})
				.catch((e) => {
					self.logger.error(`Denon AVR Volume Control::${e}`);
					defer.reject(`Denon AVR Volume Control::${e}`);
				})

		}

		return defer.promise;

	}

	self.decodeVolume = function (data) {
		if (data.includes('MV') && !data.includes('MVMAX')) {
			// Process volume from the AVR
			let vol = parseInt((data.toString().replace('MV', '') == '--') ? 0 : data.toString().replace('MV', ''));
			vol = (Math.floor(vol % 10) === 5) ? Math.round(vol / 10) : vol;
			Volume.vol = (vol >= 0 && vol <= 98) ? vol : Volume.vol;
			self.commandRouter.volumioupdatevolume(Volume);
			self.logger.info(`Denon AVR Volume Control::Current volume is: ${data.toString().replace('MV', '')}`);

		} else if (data.includes('MVMAX')) {
			// Process Max volume restriction from the AVR
			let maxvol = parseInt(data.toString().replace('MVMAX', ''));
			volumeSettings.maxvolume = (Math.floor(maxvol % 10) === 5) ? Math.round(maxvol / 10) : 98;
			// self.commandRouter.volumioUpdateVolumeSettings(volumeSettings);
			self.logger.info(`Denon AVR Volume Control::Max volume allowed is: ${volumeSettings.maxvolume}`);
		}
	}

	self.sendCommand = function (cmd) {
		var defer = libQ.defer();

		if (activeDevice && cmd) {
			activeDevice.write(cmd, (err) => {
				(!err) ? defer.resolve : defer.reject;
			});
		}
		return defer.promise;
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
		var self = this;

		self.logger.info('denonAvrVolumeControl::SetAlsaVolume' + VolumeInteger);

		switch (VolumeInteger) {
			case 'mute':
				// Mute
				self.sendCommand('MUON').then(() => {
					Volume.mute = true;
					Volume.disableVolumeControl = false;
					defer.resolve(Volume);
				});

				break;
			case 'unmute':
				// Unmute
				self.sendCommand('MUOFF').then(() => {
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
				self.sendCommand('MVUP').then(() => {
					defer.resolve(Volume);
				});

				break;
			case '-':
				VolumeInteger = Number(Volume.vol) + Number(volumeSettings.volumesteps);
				if (VolumeInteger < 0) {
					VolumeInteger = 0;
				}
				if (VolumeInteger > volumeSettings.maxvolume) {
					VolumeInteger = volumeSettings.maxvolume;
				}
				Volume.vol = VolumeInteger;
				Volume.mute = false;
				Volume.disableVolumeControl = false;
				self.sendCommand('MVDOWN').then(() => {
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
				self.sendCommand(`MV${VolumeInteger}`).then(() => {
					defer.resolve(Volume);
				});
		}

		return defer.promise;

	}
}
'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var heos = require('heos-api')


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
	this.commandRouter.sharedVars.registerCallback('alsa.outputdevicemixer', this.setupVolCtrl.bind(this));

	return libQ.resolve();
}

denonAvrVolumeControl.prototype.onStart = function () {
	var self = this;
	var defer = libQ.defer();

	//Setup the plugin to do its thing
	self.setupVolCtrl().then(() => defer.resolve());

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
	self.setupVolCtrl().then(() => defer.resolve());

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

denonAvrVolumeControl.prototype.setupVolCtrl = function () {
	var self = this;
	var defer = libQ.defer();
	if (this.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getConfigParam', 'mixer_type') == 'None') {
		//Set everything up and allow the volume to be changed. We only want to be messing with the volume if nothing else is.
		heos.discoverAndConnect().then(connection =>
			connection
				.on(
					{
						commandGroup: 'event',
						command: 'player_volume_changed'
					},
					(player) => {
						/* 
						5.9 Player Volume Changed
						Response:
						{
							"heos": {
							"command": "event/player_volume_changed ",
							"message": "pid='player_id'&level='vol_level'&mute='on_or_off'"
							}
						}
						*/

					})
		)

		defer.resolve()
	}

	return defer.promise;
}


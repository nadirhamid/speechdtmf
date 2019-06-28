
'use strict';

var client = require('ari-client');
var speech = require('@google-cloud/speech');
var fs = require('fs');
var util = require('util');
var uuid = require('uuid');

var ariUser = "freepbxuser";
var ariPassword = "750c122e9f70030dddd9c6015853778a";
var ariUrl = "http://localhost:8088";
var waitTimeout = 20;
var waitTimeoutMs = waitTimeout * 1000;
var keyTimeout = 2;
var keyTimeoutMs = keyTimeout * 1000;
var lastKey = null;
var recordTimeoutMs = waitTimeoutMs;
var speechDidFinish = false;
var dtmfDidFinish = false;
var speechResult = "";
var dtmfResult = "";
var recordingFolder = "/var/spool/asterisk/recording";

var recordParams = {
	maxDurationSeconds: waitTimeout,
	maxSilenceSeconds: 3
};

function setAVar(channel, key, value)
{
	return ari.channels.setChannelVar({channelId: channel.id, variable: key, value: value});
}
function setVarsAndFinish(channel) {
	console.log("setVarsAndFinish  called", arguments);
	if (speechDidFinish && dtmfDidFinish) {
		var resultType = "";
		if (dtmfResult !== "") {
			resultType = "dtmf";
		} else if (speechResult !== "") {
			resultType = "speech";
		}

		var promises = [];
		promises.push(setAVar(channel, "RESULTTYPE", resultType));
		promises.push(setAVar(channel, "DTMFRESULT", dtmfResult));
		promises.push(setAVar(channel, "SPEECHRESULT", speechResult));

		Promise.all(promises)
			.then(function() {
				ari.channels.continueInDialplan(params).then(function(err) {
					if (err) {
						console.log("setVarsAndFinish error occured ", arguments);
						return;
					}
				});
			}).catch(function(err) {
				console.error("setVarsAndFinish error occured", arguments);
				return;
			});
	}
}

function finishSpeech(channel) {
	console.log("finishSpeech called ", arguments);
	speechDidFinish = true;
	check(channel);
}
function finishDtmf(channel) {
	console.log("finishDtmf called ", arguments);
	dtmfDidFinish = true;
	check(channel);
}

function interKeyCheck()
{
	console.log("interKeyCheck called ", arguments);
	lastKey = Date.now();
	setTimeout(function() {
		var now = Date.now();
		if (lastKey !== null) {
			var delta =(now - lastKey);
			if (delta>=keyTimeoutMs) {
				finishSpeech(channel);
				finishDtmf(channel);
				return;
			}
		}
	}, keyTimeoutMs);
}
function keyTimeoutCheck() {
	console.log("keyTimeoutCheck called ", arguments);
	setTimeout(function() {
		finishDtmf(channel);
	}, waitTimeoutMs);
}

function doSTT()
{
	console.log("doSTT called ", arguments);
	const speechClient = new speech.SpeechClient();
	const file = fs.readFileSync(filePath);
	const audioBytes = file.toString('base64');
	const audio = {
		content: audioBytes,
	};
	const config = {
		encoding: 'LINEAR16',
		sampleRateHertz: 8000,
		languageCode: 'en-US'
	};
	const request = {
		audio,
		config
	};

	speechClient .recognize(request).then(function(data) {
		const results = data[0].results;
		const transcription = results.map(result => result.alternatives[0].transcript) .join('\n');
		speechResult = transcription;
		console.log("doSTT speech result was  ", speechResult);
		finishSpeech(channel);
	}).catch(err => {
		console.error("doSTT error ", arguments);
	});
}
function recordWait(id)
{
	console.log("recordWait called ", arguments);
	setTimeout(function() {
		ari.recordings.stop({recordingName: id}, function (err) {
			if (err) {
				console.error("recordWait error ", arguments);
				finishSpeech(channel);
				return;
			}
			doSTT();
		});
	}, recordTimeoutMs);
}
function registerDtmfListeners (err, channel, playback, incoming) {
	console.log("registerDtmfListeners called ", arguments);
	channel.on('ChannelDtmfReceived', function (event, channel) {
		if (dtmfDidFinish) {
			return;
		}
		var digit = event.digit;
		lastKey = Date.now();
		interKeyCheck();
		dtmfResult = dtmfResult + digit;
	});
	keyTimeoutCheck();
}
function registerSpeechListeners (err, channel, playback, incoming) {
	console.log("registerSpeechListeners called ", arguments);
	var params = Object.assign({}, recordParams);
	var id = uuid.v1();
	params.name = id;
	params.channelId = channel.id;
	//params.ifExists = "overwrite";
	params.format = "wav";
	var filePath = recordingFolder+"/"+id+".wav";
	ari.channels.record(params, function (err, liverecording) {
		if (err) {
			console.error("registerSpeechListeners error occured ", arguments);
			return;
		}
		recordWait( id );
	});
}

client.connect(ariUrl, ariUser, ariPassword, function (err, ari) {
	if (err) {
		return;
	}
	ari.once('StasisStart', function (event, incoming) {
		incoming.answer(function (err) {
			var playback = ari.Playback();
			// play our intro speech
			incoming.play( {media: 'sound:Item' }, playback, function (err, playback) {
				if (err) {
					return;
				}
				playback.once("PlaybackFinished", function() {
						registerSpeechListeners(err, incoming, playback, incoming);
				});
				registerDtmfListeners(err, incoming, playback, incoming);
			});
		});
	});
  // can also use ari.start(['app-name'...]) to start multiple applications
  ari.start('speechdtmf');
});

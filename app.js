'use strict';

var client = require('ari-client');
var speech = require('@google-cloud/speech');
var fs = require('fs');
var util = require('util');
var uuid = require('uuid');
var apicalls = require('./apicalls');
var doSTT = apicalls.doSTT;

var ari;
var waitTimeout = 5;
var waitTimeoutMs = waitTimeout * 1000;
var keyTimeout = 2;
var keyTimeoutMs = keyTimeout * 1000;
var recordingFolder = "/var/spool/asterisk/recording";
var promptFile = "silence-5";

var recordParams = {
    maxDurationSeconds: waitTimeout,
    maxSilenceSeconds: 3
};

var recordTimeoutMs = recordParams['maxDurationSeconds']*1000;

function AppChannel(channel) {
	this.speechDidFinish = false;
	this.dtmfDidFinish = false;
	this.speechResult = "";
	this.dtmfResult = "";
	this.playbackStarted = null;
	this.playbackFinished = null;
	this.channel = channel;
}

function setAVar(channel, key, value) {
    return ari.channels.setChannelVar({
        channelId: channel.id,
        variable: key,
        value: value
    });
}

function setVarsAndFinish(appChannel) {
    console.log("setVarsAndFinish called");
    if (appChannel.speechDidFinish && appChannel.dtmfDidFinish) {
        var resultType = "";
        if (appChannel.dtmfResult !== "") {
            resultType = "dtmf";
        } else if (appChannel.speechResult !== "") {
            resultType = "speech";
        }

        var promises = [];
	var channel = appChannel.channel;
        promises.push(setAVar(channel, "RESULTTYPE", resultType));
        promises.push(setAVar(channel, "DTMFRESULT", appChannel.dtmfResult));
        promises.push(setAVar(channel, "SPEECHRESULT", appChannel.speechResult));

        Promise.all(promises)
            .then(function() {
		var params = { channelId: appChannel.channel.id };
                ari.channels.continueInDialplan(params).then(function(err) {
                    if (err) {
                        console.log("setVarsAndFinish error occured", arguments);
                        return;
                    }
                });
            }).catch(function(err) {
                console.error("setVarsAndFinish error occured", arguments);
                return;
            });
    }
}

function finishSpeech(appChannel) {
    console.log("finishSpeech called");
    appChannel.speechDidFinish = true;
    setVarsAndFinish(appChannel);
}

function finishDtmf(appChannel) {
    console.log("finishDtmf called");
    appChannel.dtmfDidFinish = true;
    setVarsAndFinish(appChannel);
}

function registerDtmfListeners(err, appChannel, playback) {
    console.log("registerDtmfListeners called");
   
    function interKeyCheck() {
        console.log("interKeyCheck called");
        lastKey = Date.now();
        setTimeout(function() {
            var now = Date.now();
            if (lastKey !== null) {
                var delta = (now - lastKey);
                if (delta >= keyTimeoutMs) {
                    finishSpeech(appChannel);
                    finishDtmf(appChannel);
                    return;
                }
            }
        }, keyTimeoutMs);
    }
    var lastKey = null;
    appChannel.channel.on('ChannelDtmfReceived', function(event, channel) {
        if (dtmfDidFinish) {
            return;
        }
        var digit = event.digit;
        lastKey = Date.now();
        interKeyCheck();
        dtmfResult = dtmfResult + digit;
    });

    setTimeout(function() {
        finishDtmf(appChannel);
    }, waitTimeoutMs);
}

function registerSpeechListeners(appChannel, playback) {
    console.log("registerSpeechListeners called");
    var params = Object.assign({}, recordParams);
    var id = uuid.v1();
    params.name = id;
    params.channelId = appChannel.channel.id;
    //params.ifExists = "overwrite";
    params.format = "wav";
	// take out the length of the playback from the
	// time we wait for intro playback speech
	// we dont want to wait added time for the recording to be
	// on the file system 
	params.maxDuration = (appChannel.playbackFinished-appChannel.playbackStarted)/1000;

    var filePath = recordingFolder + "/" + id + ".wav";
    ari.channels.record(params, function(err, liverecording) {
		if (err) {
			console.error("registerSpeechListeners error occured ", arguments);
			return;
		}
		setTimeout(function() {
			fs.access(filePath, fs.F_OK, function(err) {
				 if (err) {
					ari.recordings.stop({
						recordingName: id
					}, function(err) {
						if (err) {
							startSTT(appChannel, filePath);
							return;
						}

						startSTT(appChannel, filePath);
					});
					return;
				}
				startSTT(appChannel, filePath);
			});
		}, recordTimeoutMs);
	});
}
function startSTT(appChannel, filePath) {
	setTimeout(function() {
		doSTT(filePath).then(function(data) {
			const results = data[0].results;
			const transcription = results.map(function(result) {
				return result.alternatives[0].transcript).join('\n');
			});
			console.log("doSTT speech result was", transcription);
			appChannel.speechResult = transcription;
			finishSpeech(appChannel)
		}).catch(function(err) {
			console.error("doSTT error ", arguments);
		});
	}, 2000);
}

client.connect(process.env.ARI_HOST, process.env.ARI_USER, process.env.ARI_PASSWORD, function(err, localAri) {
	if (err) {
		return;
	}
	ari = localAri;
	ari.on('StasisStart', function(event, incoming) {
		console.log('starting speechdtmf');
		incoming.answer(function(err) {
			var appChannel = new AppChannel(incoming);
			var playback = ari.Playback();
			// play our intro speech
			appChannel.playbackStarted = Date.now();
			incoming.play({
				media: 'sound:'+promptFile
			}, playback, function(err, playback) {
				if (err) {
					return;
				}
				playback.once("PlaybackFinished", function() {
					appChannel.playbackFinished = Date.now();
					registerSpeechListeners(appChannel, playback);
				});
				registerDtmfListeners(err, appChannel, playback);
			});
		});
	});
	// can also use ari.start(['app-name'...]) to start multiple applications
	ari.start('speechdtmf');
});

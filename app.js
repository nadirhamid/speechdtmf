'use strict';
var client = require('ari-client');
var speech = require('@google-cloud/speech');
var fs = require('fs');
var util = require('util');
var uuid = require('uuid');
var env = require('dotenv');
var apicalls = require('./apicalls');
env.config({ path: '.env' });
var doSTT = apicalls.doSTT;
var ari;
var defaults = {
    promptFile: "silence-5",
    waitTimeout: 5,
    keyTimeout: 2
};
var recordingFolder = "/var/spool/asterisk/recording";

function AppChannel(channel, promptFile, waitTimeout, keyTimeout) {
    this.speechDidFinish = false;
    this.dtmfDidFinish = false;
    this.finished = false;
    this.speechResult = "";
    this.dtmfResult = "";
    this.playbackStarted = null;
    this.playbackFinished = null;
    this.promptFile = promptFile;
    this.waitTimeout = waitTimeout;
    this.keyTimeout = keyTimeout;
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
    if (appChannel.speechDidFinish && appChannel.dtmfDidFinish && !appChannel.finished) {
        // set a local variable that tells us
        // that this call's speechdtmf already finished
        // this is so that multiple calls made by the speech/dtmf
        // listeners dont retry to set the channel vars
        appChannel.finished = true;
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
        Promise.all(promises).then(function() {
            var params = {
                channelId: appChannel.channel.id
            };
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
                if (delta >= keyTimeoutMs && !appChannel.dtmfDidFinish) {
                    finishSpeech(appChannel);
                    finishDtmf(appChannel);
                    return;
                }
            }
        }, keyTimeoutMs);
    }
    var lastKey = null;
    var waitTimeoutMs = appChannel.waitTimeout * 1000;
    var keyTimeoutMs = appChannel.keyTimeout * 1000;
    appChannel.channel.on('ChannelDtmfReceived', function(event, channel) {
        if (appChannel.dtmfDidFinish) {
            return;
        }
        var digit = event.digit;
        lastKey = Date.now();
        interKeyCheck();
        appChannel.dtmfResult = appChannel.dtmfResult + digit;
    });
    setTimeout(function() {
        finishDtmf(appChannel);
    }, waitTimeoutMs);
}

function registerSpeechListeners(appChannel, playback) {
    console.log("registerSpeechListeners called");
    var recordParams = {
        maxDurationSeconds: appChannel.waitTimeout,
        maxSilenceSeconds: 3
    };
    var recordTimeoutMs = recordParams['maxDurationSeconds'] * 1000;
    var params = Object.assign({}, recordParams);
    var id = uuid.v1();
    params.name = id;
    params.channelId = appChannel.channel.id;
    //params.ifExists = "overwrite";
    params.format = "wav";
    // take out the length of the playback from the
    // time we wait for recording speech.
    // we dont want to wait added time for the recording to be
    // on the file system
    params.maxDuration = (appChannel.playbackFinished - appChannel.playbackStarted) / 1000;
    var filePath = recordingFolder + "/" + id + ".wav";
    ari.channels.record(params, function(err, liverecording) {
        if (err) {
            console.error("registerSpeechListeners error occured ", arguments);
            return;
        }
        setTimeout(function() {
            ari.recordings.stop({
                recordingName: id
            }, function(err) {
                startSTT(appChannel, filePath);
            });
        }, recordTimeoutMs);
    });
}

function startSTT(appChannel, filePath) {
    var maxWait = 10;
    var maxWaitMs = maxWait * 1000;
    var waited = 0;
    var last = Date.now();
    // wait until the recording file can be processed
    // by the stasis app
    var interval = setInterval(function() {
        waited = Date.now() - last;
        if (waited > maxWaitMs) {
            clearInterval(interval);
            return;
        }
        fs.access(filePath, fs.F_OK, function(err) {
            if (err) {
                return;
            }
            clearInterval(interval);
            doSTT(filePath).then(function(data) {
                const results = data[0].results;
                const transcription = results.map(function(result) {
                    return result.alternatives[0].transcript;
                }).join('\n');
                console.log("doSTT speech result was", transcription);
                fs.unlink(filePath, function(err) {
                    appChannel.speechResult = transcription;
                    finishSpeech(appChannel)
                });
            }).catch(function(err) {
                console.error("doSTT error ", arguments);
            });
        });
    }, 1);
}
client.connect(process.env.ARI_HOST, process.env.ARI_USER, process.env.ARI_PASSWORD, function(err, localAri) {
    if (err) {
        return;
    }
    ari = localAri;
    ari.on('StasisStart', function(event, incoming) {
        console.log('starting speechdtmf', event);
        incoming.answer(function(err) {
            var promptFile = defaults.promptFile;
            var waitTimeout = defaults.waitTimeout;
            var keyTimeout = defaults.keyTimeout;
            if (typeof event.args[0] !== 'undefined') {
                promptFile = event.args[0];
            }
            if (typeof event.args[1] !== 'undefined') {
                waitTimeout = event.args[1];
            }
            if (typeof event.args[2] !== 'undefined') {
                keyTimeout = event.args[2];
            }
            var appChannel = new AppChannel(incoming, promptFile, waitTimeout, keyTimeout);
            var playback = ari.Playback();
            // play our intro speech
            appChannel.playbackStarted = Date.now();
            incoming.play({
                media: 'sound:' + promptFile
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
    ari.start('speechdtmf');
});

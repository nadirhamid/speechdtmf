
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

client.connect(ariUrl, ariUser, ariPassword, 
    function (err, ari) {
		if (err) {
			console.error("connection error", err);
			return;
		}
  		ari.once('StasisStart', function (event, incoming) {

			incoming.answer(function (err) {
				var playback = ari.Playback();
				// play our intro speech
				incoming.play( {media: 'sound:Item' }, playback, function (err, playback) {
					if (err) {
						console.error("playback error", err);
						return;
					}
					playback.once("PlaybackFinished", function() {
							registerSpeechListeners(err, incoming, playback, incoming);
					});
					registerDtmfListeners(err, incoming, playback, incoming);
				}
			);
		});
  });

  function setVarsAndFinish(channel) {
	if (speechDidFinish && dtmfDidFinish) {
		var resultType = "";
		if (dtmfResult !== "") {
			resultType = "dtmf";
		} else if (speechResult !== "") {
			resultType = "speech";
		}
		console.log("resultType ", resultType);
		console.log("dtmfResult ", dtmfResult);
		console.log("speechResult ", speechResult);
		var promises = [];
		promises.push(ari.channels.setChannelVar({channelId: channel.id, variable: "RESULTTYPE", value: resultType}));
		Promise.all([
			ari.channels.setChannelVar({channelId: channel.id, variable: "RESULTTYPE", value: resultType}),
			ari.channels.setChannelVar({channelId: channel.id, variable: "DTMFRESULT", value: dtmfResult}),
			ari.channels.setChannelVar({channelId: channel.id, variable: "SPEECHRESULT", value: speechResult})
		]).then(function() {
			ari.channels.continueInDialplan({channelId: channel.id}).then(function(err) {
				if (err) {
					console.error("error in check continuuing in dialplan", err);
					return;
				}
					
			});
		}, function(err) {
			console.error("error in check when setting channel variables", err);
			return;
		});

	}
   }
  function finishSpeech(channel) {
	speechDidFinish = true;
	check(channel);
  }
  function finishDtmf(channel) {
	dtmfDidFinish = true;
	check(channel);
  }
  /**
   *  Register playback dtmf events to control playback.
   *
   *  @function registerDtmfListeners
   *  @memberof playback-example
   *  @param {Error} err - error object if any, null otherwise
   *  @param {module:resources~Playback} playback - the playback object to
   *    control
   *  @param {module:resources~Channel} incoming - the incoming channel
   *    responsible for playing and controlling the playback sound
   */
  function registerDtmfListeners (err, channel, playback, incoming) {
    channel.on('ChannelDtmfReceived',
        /**
         *  Handle DTMF events to control playback. 5 pauses the playback, 8
         *  unpauses the playback, 4 moves the playback backwards, 6 moves the
         *  playback forwards, 2 restarts the playback, and # stops the playback
         *  and hangups the channel.
         *
         *  @callback channelDtmfReceivedCallback
         *  @memberof playback-example
         *  @param {Object} event - the full event object
         *  @param {module:resources~Channel} channel - the channel on which
         *    the dtmf event occured
         */
        function (event, channel) {
  	if (dtmfDidFinish) {
		return;
	}
	console.log("received dtmf input ", event);
      var digit = event.digit;
	lastKey = Date.now();
	setTimeout(function() {
		var now = Date.now();
		if (lastKey !== null) {
			console.log("lastKey ", lastKey);
			console.log("now ", now);
			var delta =(now - lastKey);
			console.log("delta ", delta);
			console.log("keyTimeoutMs", keyTimeoutMs);
			if (delta>=keyTimeoutMs) {
				finishSpeech(channel);
				finishDtmf(channel);
				return;
			}
		}
	}, keyTimeoutMs);
      dtmfResult = dtmfResult + digit;
    });
    setTimeout(function() {
	finishDtmf(channel);
    }, waitTimeoutMs);
  }

  function registerSpeechListeners (err, channel, playback, incoming) {
	var params = Object.assign({}, recordParams);
	var id = uuid.v1();
	params.name = id;
	params.channelId = channel.id;
	//params.ifExists = "overwrite";
	params.format = "wav";
	console.log("recording parameters are ", params);
	var filePath = recordingFolder+"/"+id+".wav";
	ari.channels.record(params, function (err, liverecording) {
		if (err) {
			console.error("registerSpeechListeners", err );
			return;
		}
		setTimeout(function() {
			ari.recordings.stop({recordingName: id}, function (err) {
				if (err) {
					console.error("registerSpeechListeners recording stop error", err );
					finishSpeech(channel);
					return;
				}
				setTimeout(function() {
				
					// Creates a client
					  const speechClient = new speech.SpeechClient();
					  
					  // The path to the audio file to transcribe
					  // Reads a local audio file and converts it to base64
					  const file = fs.readFileSync(filePath);
					  const audioBytes = file.toString('base64');
					  const audio = {
					    content: audioBytes,
					  };
					  
					  // The audio file's encoding, sample rate in hertz, and BCP-47 language code
					  const config = {
					    encoding: 'LINEAR16',
					    sampleRateHertz: 8000,
					    languageCode: 'en-US',
					  };
					  const request = {
					    audio,
					    config
					  };
					 
					  // Detects speech in the audio file
					  speechClient
					    .recognize(request)
					    .then((data) => {
					      const results = data[0].results;
					      const transcription = results
						.map(result => result.alternatives[0].transcript)
						.join('\n');
					      console.log(`Transcription: ${transcription}`);
						speechResult = transcription;
						finishSpeech(channel);
					    })
					    .catch(err => {
					      console.error('ERROR:', err);
					    });
				}, 2000);
			});
		}, recordTimeoutMs);
	});
  }
  // can also use ari.start(['app-name'...]) to start multiple applications
  ari.start('speechdtmf');
});

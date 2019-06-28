var speech = require('@google-cloud/speech');
var fs = require('fs');

function doSTT() {
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

    return speechClient.recognize(request);
}

module.exports = {
	doSTT: doSTT
}
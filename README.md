# ARI speechdtmf

this is an asterisk ARI Stasis app that will gather DTMF and speech input at the same time using Google STT and
asterisk ARI events.

# requirements

```
node >= v10
```

tested on

```
asterisk==13.22.0
node==10.16.0
```

# installation
- clone github project

```
git clone https://github.com/nadirhamid/speechdtmf
```

- install NPM dependencies

```
npm install
```

# configuration
- move .env.example to .env
- update environment variables
* ARI_HOST
the host and port asterisk is running ARI on
* ARI_USER
a ARI user with full permissions
* ARI_PASSWORD
your ARI password
* GOOGLE_APPLICATION_CREDENTIAL
full path to your google service account JSON file

# deploying
we use forever to deploy the node.js app. please use the following steps to
start / stop the Stasis app.

- running

```
forever start -c "node" app.js
```

- stopping

```
forever stop {FOREVER_ID}
```

# asterisk config

stasis app signature

```
Stasis(speechdtmf,[prompt-gather-file, [gather-wait-timeout, [key-wait-timeout]]])
```

example asterisk dialplan

```
exten => _X.,1,Answer()
exten => _X.,n,Stasis(speechdtmf,silence-5)
exten => _X.,n,Verbose(result type ${RESULTTYPE})
exten => _X.,n,Verbose(speech result ${SPEECHRESULT})
exten => _X.,n,Verbose(dtmf result ${DTMFRESULT})
exten => _X.,n,Hangup()
```


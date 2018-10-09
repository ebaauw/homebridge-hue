# homebridge-hue
[![npm](https://img.shields.io/npm/dt/homebridge-hue.svg)](https://www.npmjs.com/package/homebridge-hue) [![npm](https://img.shields.io/npm/v/homebridge-hue.svg)](https://www.npmjs.com/package/homebridge-hue)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Homebridge plugin for Philips Hue and/or deCONZ
Copyright © 2016-2018 Erik Baauw. All rights reserved.

This [homebridge](https://github.com/nfarina/homebridge) plugin exposes ZigBee lights, plugs, sensors, and switches connected to (1) a Philips [Hue](http://www2.meethue.com/) bridge or (2) a dresden elektronik [deCONZ](https://github.com/dresden-elektronik/deconz-rest-plugin) gateway to Apple's [HomeKit](http://www.apple.com/ios/home/).  It provides the following features:

- HomeKit support for **contact sensors**, including:
  - Heiman door/window sensor (2),
  - Xiaomi Aqara door/window sensor (2),
  - Xiaomi Mi door/window sensor (2);
- HomeKit support for **motion sensors**, including:
  - Heiman motion sensor (2),
  - IKEA Trådfri motion sensor (2),
  - Philips hue motion sensor,
  - Samsung SmartThings Arrival sensor (2),
  - Xiaomi Aqara motion sensor (2),
  - Xiaomi Mi motion sensor (2),
  - Xiaomi Aqara Smart Motion Sensor / Vibration sensor (2);
- Homekit support for **ambient light sensors**, including:
  - Philiph hue motion sensor;
- HomeKit support for **weather** and **temperature/humidity sensors**, including:
  - Heiman temperature/humidity sensor (2),
  - Philips hue motion sensor,
  - Xiaomi Aqara weather sensor (2),
  - Xiaomi Mi temperature/humidity sensor (2);
- HomeKit support for **carbon-monoxide (CO) sensors**, including:
  - Heiman carbon-monoxide sensor (2),
- HomeKit support for **fire sensors**, including:
  - Heiman combustable gas sensor (2),
  - Heiman smoke sensor (2);
- HomeKit support for **water sensors**, including:
  - Heiman water sensor (2),
  - Xiaomi Aqara leak sensor (2);
- HomeKit support for **built-in sensors**:
  - Daylight sensor,
  - CLIP sensors: OpenClose, Presence, LightLevel, Temperature, Humidity, Pressure (2), CarbonMonoxide (2), Fire (2), Water (2)
  - Writeable CLIP sensors: GenericFlag, GenericStatus,
  - Multi-CLIP: Combine multiple CLIP sensors into one HomeKit accessory;
- History support in Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) app for contact sensors (cf. Eve Door), motion sensors (cf. Eve Motion), weather, temperature/humidity, and temperature sensors (cf. Eve Weather and Eve Degree), including (multi-)CLIP versions of these;
- HomeKit support for **switches**, including the list below.  Note that you need a home hub to use these switches in HomeKit, see [Prerequisites](#prerequisites):
  - Gira Light Link wall transmitter (2),
  - IKEA Trådfri remote (2),
  - IKEA Trådfri wireless dimmer (2),
  - innr remote RC 110 (2),
  - Philips hue bridge link button (1),
  - Philips hue dimmer switch,
  - Philips hue tap,
  - ubisys C4 control unit (2),
  - ubisys D1 dimmer and (2),
  - Xiaomi Aqara smart cube (2),
  - Xiaomi Aqara smart wireless switch (2),
  - Xiaomi Mi smart cube (2),
  - Xiaomi Mi wireless switch (2),
  - Xiaomi wall switch (2);
- HomeKit support for **lights** and **plugs**:
  - Philips hue lights,
  - ZigBee Light Link (ZLL) lights and plugs from other manufacturers,
  - ZigBee 3.0 lights and plugs,
  - ZigBee Home Automation (ZHA) lights and plugs (2),
  - Heiman Siren (2),
  - Multi-Light: Combine multiple lights into one HomeKit accessory;
- HomeKit support for **power consumption** (2) as reported by smart plugs, including:
  - Heiman SmartPlug,
  - innr SP 120 smart plug
  - OSRAM Lightify plug [does _not_ report power correctly],
  - OSRAM Smart+ plug [does _not_ report power correctly],
  - Xiaomi Smart plug;
- HomeKit support for **window covering**:
  - Xiaomi Aqara curtain controller (2),
  - ubisys J1 shutter control (2);
- History support in Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) app for smart plug power consumption (cf. Eve Energy);
- HomeKit support for colour temperature on all _Color temperature lights_ and _Extended color lights_;
- HomeKit support for groups on a Hue bridge or deCONZ gateway;
- HomeKit support for enabling/disabling sensors, schedules, and rules on a Hue bridge or deCONZ gateway;
- Monitoring Hue bridge and deCONZ gateway resources (sensors, lights, groups, schedules, and rules) from HomeKit, without the need to refresh the HomeKit app.  To achieve this, homebridge-hue polls the bridge / gateway to detect state changes.  In addition, it subscribes to the push notifications provided by the deCONZ gateway;
- Automatic discovery of Hue bridges and deCONZ gateways; support for multiple bridges / gateways; support for both v2 (square) and v1 (round) Hue bridge; works in combination with the native HomeKit functionality of the v2 Hue bridge;
- Includes the command line utilities `dc_eventlog`, `json`, `ph`, and `upnp` from [homebridge-hue-utils](https://github.com/ebaauw/homebridge-hue-utils).

1) Hue bridge only  
2) deCONZ only

Please see the [WiKi](https://github.com/ebaauw/homebridge-hue/wiki) for a detailed description of homebridge-hue.

### Prerequisites
You need a Philips Hue bridge or deCONZ gateway to connect homebridge-hue to your ZigBee lights, switches, and sensors.  I recommend using the latest Hue bridge firmware, with API v1.22.0 (v2 bridge) or v1.16.0 (v1 bridge) or higher, and the latest deCONZ beta, v2.05.00 or higher.

You need a server to run homebridge.  This can be anything running [Node.js](https://nodejs.org): from a Raspberry Pi, a NAS system, or an always-on PC running Linux, macOS, or Windows.  See the [homebridge Wiki](https://github.com/nfarina/homebridge/wiki) for details.  I run deCONZ and homebridge-hue together on a Raspberry Pi 3 model B, with a [RaspBee](https://www.dresden-elektronik.de/funktechnik/solutions/wireless-light-control/raspbee/?L=1) add-on board.  
I recommend using wired Ethernet to connect the server running homebridge, the Hue bridge, and the AppleTV.

To interact with HomeKit, you need Siri or a HomeKit app on an iPhone, Apple Watch, iPad, iPod Touch, or Apple TV (4th generation or later).  I recommend to use the latest released versions of iOS, watchOS, and tvOS.  
Please note that Siri and even Apple's [Home](https://support.apple.com/en-us/HT204893) app still provide only limited HomeKit support.  To use the full features of homebridge-hue, you might want to check out some other HomeKit apps, like Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) app (free) or Matthias Hochgatterer's [Home](http://selfcoded.com/home/) app (paid).  
For HomeKit automation, you need to setup an Apple TV (4th generation or later), HomePod, or iPad as [home hub](https://support.apple.com/en-us/HT207057).

### Installation
The homebridge-hue plugin obviously needs homebridge, which, in turn needs Node.js.  I've followed these steps to set it up on my macOS server:

- Install the latest v8 LTS version of Node.js.  On a Raspberry Pi, use the 8.x [Debian package](https://nodejs.org/en/download/package-manager/#debian-and-ubuntu-based-linux-distributions). On other platforms, download the [8.x.x LTS](https://nodejs.org) installer.  Both installations include the `npm` package manager;
- On macOS, make sure `/usr/local/bin` is in your `$PATH`, as `node`, `npm`, and, later, `homebridge` install there.  On a Raspberry Pi, these install to `/usr/bin`;
- You might want to update `npm` through `sudo npm -g install npm@latest`;
- Install homebridge through `sudo npm -g install homebridge --unsafe-perm`.  Follow the instructions on [GitHub](https://github.com/nfarina/homebridge#installation) to create a `config.json` in `~/.homebridge`, as described;
- Install the homebridge-hue plugin through `sudo npm -g install homebridge-hue`;
- Edit `~/.homebridge/config.json` and add the `Hue` platform provided by homebridge-hue, see [**Configuration**](#configuration);
- Run homebridge-hue for the first time, press the link button on (each of) your bridge(s), or unlock the deCONZ gateway(s) through their web app.  Note the bridgeid/username pair for each bridge and/or gateway in the log output.  Edit `config.json` to include these, see [**Configuration**](#configuration).

Once homebridge is up and running with the homebridge-hue plugin, you might want to daemonise it and start it automatically on login or system boot.  See the [homebridge Wiki](https://github.com/nfarina/homebridge/wiki) for more info how to do that on MacOS or on a Raspberry Pi.

Somehow `sudo npm -g update` doesn't always seem to work.  To update homebridge-hue, simply issue another `sudo npm -g install homebridge-hue@latest`.  Please check the [release notes](https://github.com/ebaauw/homebridge-hue/releases) before updating homebridge-hue.  Note that a change to the minor version typically indicates that you need to review/redo your HomeKit configuration.  Due to changes in the mapping how Hue bridge resources are exposed, HomeKit might treat them as new accessories, services, and/or characteristics, losing any assignment to HomeKit rooms, scenes, actions, and triggers.  To revert to a previous version, specify the version when installing homebridge-hue, as in: `sudo npm install -g homebridge-hue@0.4.49`.

### Configuration
In homebridge's `config.json` you need to specify homebridge-hue as a platform plugin.  Furthermore, you need to specify what you want to expose to HomeKit, see the examples below.  See the [WiKi](https://github.com/ebaauw/homebridge-hue/wiki/Configuration) for a complete reference of the `config.json` settings used by homebridge-hue.

The example below is a typical configuration for a v2 (square) bridge, which already exposes the Philips Hue lights, Hue motion sensors, Hue dimmer switches, and Hue taps to HomeKit.  With this configuration, homebridge-hue exposes the non-Philips lights.
```json
  "platforms": [
    {
      "platform": "Hue",
      "users": {
        "001788FFFExxxxxx": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "001788FFFEyyyyyy": "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
      },
      "lights": true
    }
  ]
```

The example below is a typical configuration for a v2 (square) bridge where the native HomeKit feature for sensors isn't used.  With this configuration, homebridge-hue exposes the non-Philips lights and all sensor resources, except those created by the Hue app for _Home & Away_ routines.
```json
  "platforms": [
    {
      "platform": "Hue",
      "users": {
        "001788FFFExxxxxx": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "001788FFFEyyyyyy": "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
      },
      "sensors": true,
      "nativeHomeKitSensors": false,
      "excludeSensorTypes": ["CLIPPresence", "Geofence"],
      "lights": true
    }
  ]
```

For finer-grained control of what resources homebridge-hue exposes to HomeKit, create resourcelinks on the bridge / gateway for whitelists or blacklists.  The `name` of the resourcelink needs to be `"homebridge-hue"`, the `description` indicates the type of list: `"whitelist"` or `"blacklist"`.  Whitelists take precedence over blacklists.  Both whitelists and blacklists take precedence over the settings in `config.json`.  
For example, if you have a chandelier with three bulbs, you might want to expose this as a group instead of as three individual lights, by creating the following resourcelinks:
```json
{
  "name": "homebridge-hue",
  "classid": 1,
  "description": "whitelist",
  "links": [
    "/groups/1"
  ]
}
```
```json
{
  "name": "homebridge-hue",
  "classid": 1,
  "description": "blacklist",
  "links": [
    "/lights/1",
    "/lights/2",
    "/lights/3"
  ]
}
```

### Troubleshooting

#### Run homebridge-hue Solo
If you run into homebridge startup issues, please run a separate instance of homebridge with only the homebridge-hue plugin enabled in `config.json`.  This way, you can determine whether the issue is related to the homebridge-hue plugin itself, or to the interaction of multiple homebridge plugins in your setup.  You can start this separate instance of homebridge on a different system, as a different user, or from a different user directory (specified by the `-U` flag).  Make sure to use a different homebridge `name`, `username`, and (if running on the same system) `port` in the `config.json` for each instance.

#### Debug Log File
The homebridge-hue plugin outputs an info message for each HomeKit characteristic value it sets and for each HomeKit characteristic value change notification it receives.  When homebridge is started with `-D`, homebridge-hue outputs a debug message for each request it makes to the bridge / gateway, for each state change it detects while polling the bridge / gateway, and for each push notification it receives from the deCONZ gateway.  Additionally, it issues a debug message for each bridge / gateway resource it detects.

To capture these messages into a log file do the following:

- When running homebridge manually, start homebridge by issuing:
```
homebridge -D 2>&1 | tee homebridge.log
```
Hit interrupt (ctrl-C) to stop homebridge.

- When running homebridge as a service, add `-D` to the `ExecStart` line of the service definition file, typically `/etc/systemd/system/homebridge.service`.  Then reload by
```
sudo systemctl daemon-reload
sudo systemctl restart homebridge
```
To capture the log file, issue:
```
sudo journalctl -au homebridge > homebridge.log
```  

Compress the log file by issuing `gzip homebridge.log`.

#### Debug Dump File
To aid troubleshooting, on startup, homebridge-hue dumps its environment, including its `config.json` settings and the full state of all bridges / gateways into a gzipped json file, `homebridge-hue.json.gz`.  IP addresses, and bridge / gateway usernames are masked.  This file is created in the user directory, `~/.homebridge` by default.

#### Raising Issues
If you need help, please open an issue on [GitHub](https://github.com/ebaauw/homebridge-hue/issues).  Please attach a copy of `homebridge.log.gz` (see [**Debug Log File**](#debug-log-file)) and of `homebridge-hue.json.gz`  (see [**Debug Dump File**](#debug-dump-file)).  Please do not copy/paste large amounts of logging.  
For questions, you can also post a message to the **#homebridge-hue** channel of the [homebridge workspace on Slack](https://github.com/nfarina/homebridge#community).

### Caveats
The homebridge-hue plugin is a hobby project of mine, provided as-is, with no warranty whatsoever.  I've been running it successfully at my home for years, but your mileage might vary.  Please report any issues on [GitHub](https://github.com/ebaauw/homebridge-hue/issues).

Homebridge is a great platform, but not really intended for consumers, as it requires command-line interaction.

HomeKit is still relatively new, and Apple's [Home](https://support.apple.com/en-us/HT204893) app provides only limited support.  You might want to check out some other HomeKit apps, like Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) app (free), Matthias Hochgatterer's [Home](http://selfcoded.com/home/) app (paid), or, if you use `Xcode`, Apple's [HMCatalog](https://developer.apple.com/library/content/samplecode/HomeKitCatalog/Introduction/Intro.html#//apple_ref/doc/uid/TP40015048-Intro-DontLinkElementID_2) example app.

The HomeKit terminology needs some getting used to.  A _accessory_ more or less corresponds to a physical device, accessible from your iOS device over WiFi or Bluetooth.  A _bridge_ (like homebridge) is an accessory that provides access to other, bridged, accessories.  An accessory might provide multiple _services_.  Each service corresponds to a virtual device (like a lightbulb, switch, motion sensor, ..., but also: a programmable switch button, accessory information, battery status).  Siri interacts with services, not with accessories.  A service contains one or more _characteristics_.  A characteristic is like a service attribute, which might be read or written by HomeKit apps.  You might want to checkout Apple's [HomeKit Accessory Simulator](https://developer.apple.com/library/content/documentation/NetworkingInternet/Conceptual/HomeKitDeveloperGuide/TestingYourHomeKitApp/TestingYourHomeKitApp.html), which is distributed as an additional tool for `Xcode`.

HomeKit only supports 99 bridged accessories per HomeKit bridge (i.e. homebridge, not the Hue bridge).  When homebridge exposes more accessories, HomeKit refuses to pair with homebridge or it blocks homebridge if it was paired already.  While homebridge-hue checks that it doesn't expose more than 99 accessories itself, it is unaware of any accessories exposed by other homebridge plugins.  As a workaround to overcome this limit, you can run multiple instances of homebridge with different plugins and/or different homebridge-hue settings, using the `-U` flag to specify a different directory with a different `config.json` for each instance.  Make sure to use a different homebridge `name`, `username`, and `port` for each instance.

Internally, HomeKit identifies accessories by UUID.  For Zigbee devices (lights, sensors, switches), homebridge-hue bases this UUID on the Zigbee mac address.  For non-Zigbee resources (groups, schedules, CLIP sensors), the UUID is based on the bridge / gateway ID and resource path (e.g. `/sensors/1`).  By not using the resource name (e.g. `Daylight`), homebridge-hue can deal with duplicate names.  In addition, HomeKit will still recognise the accessory after the resource name has changed on the bridge / gateway, remembering which HomeKit room, groups, scenes, actions, and triggers it belongs to.  However, when a non-Zigbee bridge / gateway resource is deleted and then re-created, resulting in a different resource path, HomeKit will treat it as a new accessory, and you will need to re-configure HomeKit.

# homebridge-hue
[![npm](https://img.shields.io/npm/dt/homebridge-hue.svg)](https://www.npmjs.com/package/homebridge-hue) [![npm](https://img.shields.io/npm/v/homebridge-hue.svg)](https://www.npmjs.com/package/homebridge-hue)

## Homebridge plugin for Philips Hue
Copyright © 2016, 2017 Erik Baauw. All rights reserved.

This [homebridge](https://github.com/nfarina/homebridge) plugin exposes [Philips Hue](http://www2.meethue.com/) lights, groups, sensors, and schedules to Apple's [HomeKit](http://www.apple.com/ios/home/).  It provides the following features:
- HomeKit support for sensors connected to a Hue bridge: Hue motion sensors, Hue dimmer switches, Hue tap switches, the built-in Daylight sensor, and CLIP sensors;
- HomeKit support for all lights connected to a Hue bridge: Philips as well as non-Philips lights.  Support for colour temperature on all _Color temperature lights_ and _Extended color lights_;
- HomeKit support for Hue bridge groups;
- HomeKit support for enabling/disabling Hue bridge sensors, schedules, and rules;
- HomeKit support for the bridge link button;
- Monitoring Hue bridges resources (sensors, lights, groups, schedules, and rules) from HomeKit, without the need to refresh the HomeKit app;
- Automatic discovery of Hue bridges; support for multiple Hue bridges; support for both v2 (square) and v1 (round) Hue bridges; works in combination with the HomeKit functionality of the v2 Hue bridge.

Please see the [WiKi](https://github.com/ebaauw/homebridge-hue/wiki) for a detailed description of homebridge-hue.

### Prerequisites
To interact with HomeKit, you need Siri or a HomeKit app on an iPhone, Apple Watch, iPad, iPod Touch, or Apple TV (4th generation).  I recommend to use the latest OS versions: iOS 10.3, watchOS 3.2, and tvOS 10.2.  
Please note that Siri and even the iOS built-in [Home](https://support.apple.com/en-us/HT204893) app still provide only limited HomeKit support.  To use the full features of homebridge-hue, you might want to check out some other HomeKit apps, like Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) app (free) or Matthias Hochgatterer's [Home](http://selfcoded.com/home/) app (paid).  
For HomeKit automation, you need to setup an Apple TV (4th generation) or iPad as [Home Hub](https://support.apple.com/en-us/HT207057).

You need a Philips Hue bridge to connect homebridge-hue to your lights, switches, and sensors.  I recommend use the latest bridge firmware, with API v1.16.0 or higher.  
You need a server to run homebridge.  This can be anything running [Node.js](https://nodejs.org): from a Raspberri Pi, a NAS system, or an always-on PC running Linux, macOS, or Windows.  See the [homebridge Wiki](https://github.com/nfarina/homebridge/wiki) for details.  I use a Mac mini server, and, occasionally, a Raspberri Pi 3 model B.  
I recommend to use wired Ethernet to connect the server running homebridge, the Hue bridge, and, if applicable, the AppleTV.

### Installation
The homebridge-hue plugin obviously needs homebridge, which, in turn needs Node.js.  I've followed these steps to set it up on my macOS server:

- Install the Node.js JavaScript runtime `node`, from its [website](https://nodejs.org).  I'm using v6.11.0 LTS for macOS (x64), which includes the `npm` package manager.  v7.x also works, but v8.x is known to cause issues;
- Make sure `/usr/local/bin` is in your `$PATH`, as `node`, `npm`, and, later, `homebridge` install there;
- You might want to update `npm` through `sudo npm update -g npm@latest`.  For me, this installs npm version 5.0.4;
- Install homebridge following the instructions on [GitHub](https://github.com/nfarina/homebridge#installation).  For me, this installs homebridge version 0.4.21 to `/usr/local/lib/node_modules`.  Make sure to create a `config.json` in `~/.homebridge`, as described;
- Install the homebridge-hue plugin through `sudo npm install -g homebridge-hue@latest`;
- Edit `~/.homebridge/config.json` and add the `Hue` platform provided by homebridge-hue, see **Configuration** below;
- Run homebridge-hue for the first time, press the link button on (each of) your bridge(s), and note the bridgeid/username pair for each bridge in the log output.  Edit `config.json` to include these, see **Configuration** below.

Once homebridge is up and running with the homebridge-hue plugin, you might want to daemonise it and start it automatically on login or system boot.  See the [homebridge Wiki](https://github.com/nfarina/homebridge/wiki) for more info how to do that on MacOS or on a Raspberri Pi.

Somehow `sudo npm -g update` doesn't always seem to work.  To update homebridge-hue, simply issue another `sudo npm install -g homebridge-hue@latest`.  Please check the [release notes](https://github.com/ebaauw/homebridge-hue/releases) before updating homebridge-hue.  Note that a change to the minor version typically indicates that you need to review/redo your HomeKit configuration.  Due to changes in the mapping how Hue bridge resources are exposed, HomeKit might treat them as a new accessories, services, and/or characteristics, losing any assignment to HomeKit rooms, scenes, actions, and triggers.  To revert to a previous version, specify the version when installing homebridge-hue, as in: `sudo npm install -g homebridge-hue@0.1.14`.

### Configuration
In homebridge's `config.json` you need to specify homebridge-hue as a platform plugin.  Furthermore you need to specify what you want to expose to HomeKit, see the examples below.  See the [WiKi](https://github.com/ebaauw/homebridge-hue/wiki/Configuration) for a complete reference of the `config.json` settings used by homebridge-hue.

The example below is a typical configuration for a v2 (square) bridge, which already exposes the Philips lights to HomeKit.  With this configuration, homebridge-hue exposes Hue motion sensors, Hue dimmer switches, Hue taps, and non-Philips lights.
```json
  "platforms": [
    {
      "platform": "Hue",
      "name": "Hue",
      "users": {
        "001788FFFExxxxxx": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "001788FFFEyyyyyy": "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
      },
      "sensors": true,
      "excludeSensorTypes": ["Daylight", "CLIP", "Geofence"],
      "lights": true
    }
  ]
```

The example below is a typical configuration for exposing a v1 (round) bridge, or a v2 (square) bridge where the native HomeKit feature isn't used.  With this configuration, homebridge-hue exposes all sensor resources, except those created by the Hue app for _Home & Away_ routines, and all lights, using the Kelvin `ColorTemperature` characteristic type.
```json
  "platforms": [
    {
      "platform": "Hue",
      "name": "Hue",
      "users": {
        "001788FFFExxxxxx": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "001788FFFEyyyyyy": "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
      },
      "sensors": true,
      "excludeSensorTypes": ["CLIPPresence", "Geofence"],
      "lights": true,
      "philipsLights": true,
      "wallSwitch": true
    }
  ]
```

### Troubleshooting
If you run into homebridge startup issues, please run homebridge with only the homebridge-hue plugin enabled in `config.sys`.  This way, you can determine whether the issue is related to the homebridge-hue plugin itself, or to the interaction of multiple homebridge plugins in your setup.  Note that disabling the other plugins from your existing homebridge setup will remove their accessories from HomeKit.  You will need to re-assign these accessories to any HomeKit room, groups, scenes, actions, and triggers after re-enabling their plugins.  Alternatively, you can start a different instance of homebridge just for homebridge-hue, on a different system, as a different user, or from a different directory (specified by the `-U` flag).  Make sure to use a different homebridge `name`, `username`, and (if running on the same system) `port` in the `config.sys` for each instance.

The homebridge-hue plugin outputs an info message for each HomeKit characteristic value it sets and for each HomeKit characteristic value change notification it receives.  When homebridge is started with `-D`, homebridge-hue outputs a debug message for each request it makes to the Hue bridge and for each Hue bridge state change it detects.  Additionally, it issues a debug message for each bridge resource it detects.  To capture these messages into a logfile, start homebridge as `homebridge -D > logfile 2>&1`.

To aid troubleshooting, homebridge-hue dumps the full bridge state into a json file, when `Identify` is selected on the bridge accessory.  Bridge ID, mac address, ip address, and usernames are masked.  The file is created in `~/.homebridge`, and is named after the bridge.  Note that the Apple's [Home](http://www.apple.com/ios/home/) app does not support `Identify`, so you need another HomeKit app for that (see **Caveats** below).

If you need help, please open an issue on [GitHub](https://github.com/ebaauw/homebridge-hue/issues).  Please attach a copy of your full `config.json` (masking any sensitive info), the debug logfile, and the dump of the bridge state.

### Caveats
The homebridge-hue plugin is a hobby project of mine, provided as-is, with no warranty whatsoever.  I've been running it successfully at my home for months, but your mileage might vary.  Please report any issues on [GitHub](https://github.com/ebaauw/homebridge-hue/issues).

Homebridge is a great platform, but not really intended for consumers, as it requires command-line interaction.

HomeKit is still relatively new, and Apple's [Home](https://support.apple.com/en-us/HT204893) app provides only limited support.  You might want to check out some other HomeKit apps, like Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) app (free), Matthias Hochgatterer's [Home](http://selfcoded.com/home/) app (paid), or, if you use `Xcode`, Apple's [HMCatalog](https://developer.apple.com/library/content/samplecode/HomeKitCatalog/Introduction/Intro.html#//apple_ref/doc/uid/TP40015048-Intro-DontLinkElementID_2) example app.

The HomeKit terminology needs some getting used to.  An _accessory_ more or less corresponds to a physical device, accessible from your iOS device over WiFi or Bluetooth.  A _bridge_ (like homebridge) is an accesory that provides access to other, bridged, accessories.  An accessory might provide multiple _services_.  Each service corresponds to a virtual device (like a lightbulb, switch, motion sensor, ..., but also: a programmable switch button, accessory information, battery status).  Siri interacts with services, not with accessories.  A service contains one or more _characteristics_.  A characteristic is like a service attribute, which might be read or written by HomeKit apps.  You might want to checkout Apple's [HomeKit Accessory Simulator](https://developer.apple.com/library/content/documentation/NetworkingInternet/Conceptual/HomeKitDeveloperGuide/TestingYourHomeKitApp/TestingYourHomeKitApp.html), which is distributed a an additional tool for `Xcode`.

HomeKit only supports 99 bridged accessories per HomeKit bridge (i.e. homebridge, not the Philips Hue bridge).  When homebridge exposes more accessories, HomeKit refuses to pair with homebridge or it blocks homebridge if it was paired already.  While homebridge-hue checks that it doesn't expose more than 99 accessories itself, it is unaware of any accessories exposed by other homebridge plugins.  As a workaround to overcome this limit, you can run multiple instances of homebridge with different plugins and/or different homebridge-hue settings, using the `-U` flag to specify a different directory with a different `config.json` for each instance.  Make sure to use a different homebridge `name`, `username`, and `port` for each instance.

Internally, HomeKit identifies accessories by UUID.  For Zigbee devices (lights, Hue taps, Hue dimmer switches, Hue Motion sensors), homebridge-hue bases this UUID on the  Zigbee mac address.  For non-Zigbee resources, the UUID is based on the Hue bridge ID and resource path (e.g. `/sensors/1`).  By not using the resource name (e.g. `Daylight`), homebridge-hue can deal with duplicate names.  In addition, HomeKit will still recognise the accessory after the resource name has changed on the Hue bridge, remembering which HomeKit room, groups, scenes, actions, and triggers it belongs to.  However, when a non-Zigbee Hue bridge resource is deleted and then re-created, resulting in a different resource path, HomeKit will treat it as a new accessory, and you will need to re-configure HomeKit.

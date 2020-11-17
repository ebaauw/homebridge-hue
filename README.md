<p align="center">
  <img src="homebridge-hue.png" height="200px">  
</p>
<span align="center">

# Homebridge Hue
[![Downloads](https://img.shields.io/npm/dt/homebridge-hue)](https://www.npmjs.com/package/homebridge-hue)
[![Version](https://img.shields.io/npm/v/homebridge-hue)](https://www.npmjs.com/package/homebridge-hue)
[![Homebridge Discord](https://img.shields.io/discord/432663330281226270?color=728ED5&logo=discord&label=discord)](https://discord.gg/hZubhrz)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

[![GitHub issues](https://img.shields.io/github/issues/ebaauw/homebridge-hue)](https://github.com/ebaauw/homebridge-hue/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/ebaauw/homebridge-hue)](https://github.com/ebaauw/homebridge-hue/pulls)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen)](https://standardjs.com)

</span>

## Homebridge plugin for Philips Hue and/or deCONZ
Copyright © 2016-2020 Erik Baauw. All rights reserved.

This [Homebridge](https://github.com/homebridge/homebridge) plugin exposes ZigBee devices (lights, plugs, sensors, switches, ...) connected to (1) a Philips [Hue](http://www2.meethue.com/) bridge or (2) a dresden elektronik [deCONZ](https://github.com/dresden-elektronik/deconz-rest-plugin) gateway to Apple's [HomeKit](http://www.apple.com/ios/home/).  It provides the following features:

- HomeKit support for **contact sensors**, including:
  - Heiman door/window sensor (2),
  - Samsung SmartThings multipurpose sensor (2),
  - Xiaomi Aqara door/window sensor (2),
  - Xiaomi Mi door/window sensor (2);
- HomeKit support for **motion sensors**, including:
  - Heiman motion sensor (2),
  - IKEA Trådfri motion sensor (2),
  - Philips hue motion sensor,
  - Samsung SmartThings Arrival sensor (2),
  - Samsung SmartThings multipurpose sensor (2),
  - Xiaomi Aqara motion sensor (2),
  - Xiaomi Mi motion sensor (2),
  - Xiaomi Aqara Smart Motion Sensor / Vibration sensor (2);
- HomeKit support for **ambient light sensors**, including:
  - Philips hue motion sensor,
  - Xiaomi Aqara motion sensor (2);
- HomeKit support for **weather** and **temperature/humidity sensors**, including:
  - Heiman temperature/humidity sensor (2),
  - Philips hue motion sensor,
  - Samsung SmartThings multipurpose sensor (2),
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
- History support in the [Eve](https://www.evehome.com/en/eve-app) app for contact sensors (cf. Eve Door), motion sensors (cf. Eve Motion), weather, temperature/humidity, and temperature sensors (cf. Eve Weather and Eve Degree), including (multi-)CLIP versions of these;
- HomeKit support for **wireless switches**, including the list below.  Note that you need a home hub to use these switches in HomeKit, see [Prerequisites](#prerequisites):
  - Busch-Jaeger Light Link control element (2),
  - Busch-Jaeger Light Link wall-mounted transmitter (2),
  - dresden elektronik scene switch (2),
  - Gira Light Link wall transmitter (2),
  - Gira/Jung Light Link hand transmitter (2),
  - iCasa Pulse Keypad 2, 4S, and 8S (2),
  - IKEA Symfonisk sound controller (2),
  - IKEA Trådfri remote (2),
  - IKEA Trådfri wireless dimmer (2),
  - IKEA Trådfri on/off switch (2),
  - IKEA Trådfri open/close remote (2),
  - innr remote RC 110 (2),
  - Jung Light Link wall transmitter (2),
  - Lutron Aurora Friends-of-Hue dimmer switch,
  - Philips hue bridge link button (1),
  - Philips hue dimmer switch,
  - Philips hue smart button,
  - Philips hue tap,
  - Friends of Hue switches,
  - Samsung SmartThings Button,
  - Sunricher remote controller and CCT remote (2),
  - ubisys C4 and C4-R control unit (2),
  - ubisys D1 and D1-R dimmer (2),
  - ubisys S1, S2, S1-R, and S2-R switch (2),
  - Xiaomi Aqara smart cube (2),
  - Xiaomi Aqara smart wireless switch (2),
  - Xiaomi Aqara vibration sensor (2),
  - Xiaomi Mi smart cube (2),
  - Xiaomi Mi wireless switch (2),
  - Xiaomi wall switch (2);
- HomeKit support for **lights**, **wired in-wall switches**, and **plugs**:
  - Philips hue lights,
  - ZigBee Light Link (ZLL) lights and plugs from other manufacturers,
  - ZigBee 3.0 lights and plugs,
  - ZigBee Home Automation (ZHA) lights and plugs (2),
  - Heiman Siren (2),
  - Multi-Light: Combine multiple lights into one HomeKit accessory;
- HomeKit support for **power consumption** (2) as reported by smart plugs, or wired in-wall switches including:
  - Heiman SmartPlug,
  - innr SP 120 smart plug,
  - Xiaomi Smart plug,
  - Xiaomi Aqara wall switch;
- HomeKit support for **thermostats**:
  - Bitron Thermostat 902010/32 (2),
  - Eurotronic Spirit Zigbee (2);
- HomeKit support for **window covering** devices:
  - IKEA FYRTUR and KADRILJ (2),
  - ubisys J1 shutter control (2);
  - Xiaomi Aqara curtain controller (2),
- History support in the [Eve](https://www.evehome.com/en/eve-app) app for smart plug power consumption (cf. Eve Energy) and Thermostats (cf. Eve Thermo);
- HomeKit support for Adaptive Lighting on all _Color temperature lights_ and _Extended color lights_;
- HomeKit support for groups on a Hue bridge or deCONZ gateway, including recalling Hue bridge `GroupScene` scenes and deCONZ gateway scenes, and turning off streaming for Hue bridge `Entertainment` groups;
- HomeKit support for enabling/disabling sensors, schedules, and rules on a Hue bridge or deCONZ gateway;
- Monitoring Hue bridge and deCONZ gateway resources (sensors, lights, groups, schedules, and rules) from HomeKit, without the need to refresh the HomeKit app.  To achieve this, Homebridge Hue polls the bridge / gateway to detect state changes.  In addition, it subscribes to the push notifications provided by the deCONZ gateway;
- Automatic discovery of Hue bridges and deCONZ gateways; support for multiple bridges / gateways; support for both v2 (square) and v1 (round) Hue bridge; works in combination with the native HomeKit functionality of the v2 Hue bridge;
- Includes the command line utilities `dc_eventlog` and `ph`.

1) Hue bridge only  
2) deCONZ only

Please see the [WiKi](https://github.com/ebaauw/homebridge-hue/wiki) for a detailed description of Homebridge Hue.

### Prerequisites
You need a Philips Hue bridge or deCONZ gateway to connect Homebridge Hue to your ZigBee lights, switches, and sensors.
I recommend using the latest Hue bridge firmware, with API v1.38.0 (v2 bridge) or v1.16.0 (v1 bridge) or higher, and the latest deCONZ beta, v2.05.79 or higher.

You need a server to run Homebridge.
This can be anything running [Node.js](https://nodejs.org): from a Raspberry Pi, a NAS system, or an always-on PC running Linux, macOS, or Windows.
See the [Homebridge Wiki](https://github.com/homebridge/homebridge/wiki) for details.
I run deCONZ and Homebridge Hue together on a Raspberry Pi 3B+, with a [RaspBee](https://phoscon.de/en/raspbee) add-on board.  
I recommend using wired Ethernet to connect the server running Homebridge, the Hue bridge, and the AppleTV or HomePod acting as home hub.

To interact with HomeKit, you need Siri or a HomeKit app on an iPhone, Apple Watch, iPad, iPod Touch, or Apple TV (4th generation or later).
I recommend to use the latest released versions of iOS, watchOS, and tvOS.  
Please note that Siri and even Apple's [Home](https://support.apple.com/en-us/HT204893) app still provide only limited HomeKit support.
To use the full features of Homebridg Hue, you might want to check out some other HomeKit apps, like the [Eve](https://www.evehome.com/en/eve-app) app (free) or Matthias Hochgatterer's [Home+](https://hochgatterer.me/home/) app (paid).

As HomeKit uses Bonjour to discover Homebridge, the server running Homebridge must be on the same subnet as your iDevices running HomeKit.
For remote access and for HomeKit automations, you need to setup an Apple TV (4th generation or later), HomePod, or iPad as [home hub](https://support.apple.com/en-us/HT207057).

### Command-Line Tools
Homebridge Hue includes the following command-line tools:

Command | Description
-------- | -----------
`dc_eventlog` | Logger for deCONZ websocket notifications.
`ph` | Command line interface to Philips Hue or deCONZ REST API.

These tools takes a `-h` or `--help` argument to provide a brief overview of their functionality and command-line arguments.

### Installation
To install Homebridge Hue:
- Follow the instructions on the [Homebridge Wiki](https://github.com/homebridge/homebridge/wiki) to install Node.js and Homebridge;
- Install the Homebridge Hue plugin through Homebridge Config UI X or manually by:
  ```
  $ sudo npm -g i homebridge-hue
  ```

- Edit `config.json` and add the `Hue` platform provided by Homebridge Hue, see [**Configuration**](#configuration);
- Run Homebridge Hue for the first time, press the link button on (each of) your bridge(s), or unlock the deCONZ gateway(s) through their web app.  Note the bridgeid/username (API key) pair for each bridge and/or gateway in the log output.  Edit `config.json` to include these, see [**Configuration**](#configuration).  
Note that you cannot add these through the Homebridge Hue *Settings* in Homebridge Config UI X, but you can use the *Homebridge Config Editor*.

To update Homebridge Hue, simply issue another `sudo npm -g i homebridge-hue@latest`.  Please check the [release notes](https://github.com/ebaauw/homebridge-hue/releases) before updating Homebridge Hue.  Note that a change to the minor version typically indicates that you need to review/redo your HomeKit configuration.  Due to changes in the mapping how Hue bridge resources are exposed, HomeKit might treat them as new accessories, services, and/or characteristics, losing any assignment to HomeKit rooms, scenes, actions, and triggers.  To revert to a previous version, specify the version when installing Homebridge Hue, as in: `sudo npm -g i homebridge-hue@0.11.59`.

### Configuration
In Homebridge's `config.json` you need to specify Homebridge Hue as a platform plugin.  Furthermore, you need to specify what you want to expose to HomeKit, see the examples below.  See the [WiKi](https://github.com/ebaauw/homebridge-hue/wiki/Configuration) for a complete reference of the `config.json` settings used by Homebridge Hue.

The example below is a typical configuration for a v2 (square) bridge, which already exposes the Philips Hue lights, Hue motion sensors, Hue dimmer switches, and Hue taps to HomeKit.  With this configuration, Homebridge Hue exposes the non-Philips lights.
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

The example below is a typical configuration for a v2 (square) bridge where the native HomeKit feature for sensors isn't used.  With this configuration, Homebridge Hue exposes the non-Philips lights and all sensor resources, except those created by the Hue app for _Home & Away_ routines.
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

For finer-grained control of what resources Homebridge Hue exposes to HomeKit, create resourcelinks on the bridge / gateway for whitelists or blacklists.  The `name` of the resourcelink needs to be `"homebridge-hue"`, the `description` indicates the type of list: `"whitelist"` or `"blacklist"`.  Whitelists take precedence over blacklists.  Both whitelists and blacklists take precedence over the settings in `config.json`.  
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

#### Check Dependencies
If you run into Homebridge startup issues, please double-check what versions of Node.js and of Homebridge have been installed.
Homebridge Hue has been developed and tested using the [latest LTS](https://nodejs.org/en/about/releases/) version of Node.js and the [latest](https://www.npmjs.com/package/homebridge) version of Homebridge.
Other versions might or might not work - I simply don't have the bandwidth to test these.

#### Run Homebridge Hue Solo
If you run into Homebridge startup issues, please run a separate instance of Homebridge with only Homebridge Hue (and Homebridge Config UI X) enabled in `config.json`.
This way, you can determine whether the issue is related to Homebridge Hue itself, or to the interaction of multiple Homebridge plugins in your setup.
You can start this separate instance of Homebridge on a different system, as a different user, or from a different user directory (specified by the `-U` flag).
Make sure to use a different Homebridge `name`, `username`, and (if running on the same system) `port` in the `config.json` for each instance.

#### Debug Log File
Homebridge Hue outputs an info message for each HomeKit characteristic value it sets and for each HomeKit characteristic value change notification it receives.
When Homebridge is started with `-D`, Homebridge Hue outputs a debug message for each request it makes to the bridge / gateway, for each state change it detects while polling the bridge / gateway, and for each push notification it receives from the deCONZ gateway.  Additionally, it issues a debug message for each bridge / gateway resource it detects.

To capture these messages into a log file do the following:
- If you're running Homebridge as a service, stop that service;
- Run Homebridge manually, capturing the output into a file, by issuing:
  ```
  $ homebridge -CD 2>&1 | tee homebridge.log
  ```
- Interact with your devices, through their native app and or through HomeKit to trigger the issue;
- Hit interrupt (ctrl-C) to stop Homebridge;
- If you're running Homebridge as a service, restart the service;
- Compress the log file by issuing:
  ```
  $ gzip homebridge.log
  ```

#### Debug Dump File
To aid troubleshooting, on startup, Homebridge Hue dumps its environment, including its `config.json` settings and the full state of all bridges / gateways into a compresed json file, `homebridge-hue.json.gz`.
IP addresses, and bridge / gateway usernames are masked.
This file is created in the Homebridge user directory, `~/.homebridge` by default.
It can be downloaded through the Homebridge Config UI X user interface, from the Homebridge Hue _SETTINGS_ popup window, on the _Plugins_ tab.

#### Getting help
If you have a question, please post a message to the **#hue** channel of the Homebridge community on [Discord](https://discord.gg/hZubhrz).

If you encounter a problem, please open an issue on [GitHub](https://github.com/ebaauw/homebridge-hue/issues).
Please attach a copy of `homebridge-hue.json.gz` to the issue, see [**Debug Dump File**](#debug-dump-file).
Please attach a copy of `homebridge.log.gz` to the issue, see [**Debug Log File**](#debug-log-file).
Please do **not** copy/paste large amounts of log output.

### Contributing
Sometimes I get the question how people can support my work on Homebridge Hue.
I created Homebridge Hue as a hobby project, for my own use.
I share it on GitHub so others might benefit, and to give back to the open source community, without whom Homebridge Hue wouldn't have been possible.

Having said that, adding support for new devices, in Homebridge Hue, and in the deCONZ REST API plugin, is very hard without having physical access to the device.
Since this is a hobby project, I cannot afford to spend money on devices I won't be using myself, just to integrate them for the benefit of others.
I am happy to receive small donations in the form of new devices to integrate, or the money to buy these devices myself.
I am also happy to return the devices afterwards, if you provide the shipping costs.
Please contact me by email or on Discord for shipping details.

### Caveats
Homebridge Hue is a hobby project of mine, provided as-is, with no warranty whatsoever.  I've been running it successfully at my home for years, but your mileage might vary.

The HomeKit terminology needs some getting used to.
An _accessory_ more or less corresponds to a physical device, accessible from your iOS device over WiFi or Bluetooth.
A _bridge_ (like Homebridge) is an accessory that provides access to other, bridged, accessories.
An accessory might provide multiple _services_.
Each service corresponds to a virtual device (like a lightbulb, switch, motion sensor, ..., but also: a programmable switch button, accessory information, battery status).
Siri interacts with services, not with accessories.
A service contains one or more _characteristics_.
A characteristic is like a service attribute, which might be read or written by HomeKit apps.
You might want to checkout Apple's [HomeKit Accessory Simulator](https://developer.apple.com/documentation/homekit/testing_your_app_with_the_homekit_accessory_simulator), which is distributed as an additional tool for `Xcode`.

Internally, HomeKit identifies accessories by UUID.  For Zigbee devices (lights, sensors, switches), Homebridge Hue bases this UUID on the Zigbee mac address.  For non-Zigbee resources (groups, schedules, CLIP sensors), the UUID is based on the bridge / gateway ID and resource path (e.g. `/sensors/1`).  By not using the resource name (e.g. `Daylight`), Homebridge Hue can deal with duplicate names.  In addition, HomeKit will still recognise the accessory after the resource name has changed on the bridge / gateway, remembering which HomeKit room, groups, scenes, actions, and triggers it belongs to.  However, when a non-Zigbee bridge / gateway resource is deleted and then re-created, resulting in a different resource path, HomeKit will treat it as a new accessory, and you will need to re-configure HomeKit.

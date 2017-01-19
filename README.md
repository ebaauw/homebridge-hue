# homebridge-hue
[![npm](https://img.shields.io/npm/dt/homebridge-hue.svg)](https://www.npmjs.com/package/homebridge-hue) [![npm](https://img.shields.io/npm/v/homebridge-hue.svg)](https://www.npmjs.com/package/homebridge-hue)

## Homebridge plugin for Philips Hue
(C) 2016-2017, Erik Baauw

This [homebridge](https://github.com/nfarina/homebridge) plugin exposes [Philips Hue](http://www2.meethue.com/) bridge lights, groups, sensors, and schedules to Apple's [HomeKit](http://www.apple.com/ios/home/).  It provides the following features:
- HomeKit support for Hue Motion sensors, Hue Dimmer switches, Hue Tap switches, the built-in Daylight sensor, and CLIP sensors;
- HomeKit support for non-Philips lights;
- HomeKit support for colour temperature on Philips and non-Philips Color Temperature Lights and Extended Color Lights;
- HomeKit support for Hue bridge groups;
- HomeKit support for enabling/disabling Hue bridge schedules and rules;
- Monitoring Hue bridges resources (lights, groups, sensors, schedules, and rules) from HomeKit, without the need to refresh the HomeKit app;
- Support for both v2 (square) and v1 (round) Hue bridges;
- Support for multiple Hue bridges;
- Automatic discovery of Hue bridges.

## Bridges
The homebridge-hue plugin tries to discover any Hue bridge on your network by querying the Meethue portal.  Alternatively, the hostname(s) and/or IP address(es) of the Hue bridge(s) can be specified in `config.json`.  Both v2 (square) as well as v1 (round) Hue bridges are supported.

For each bridge, homebridge-hue creates a HomeKit accessory, with a `Stateful Programmable Switch` service and an accessory information service.  Each supported and enabled Hue bridge resource (light, group, sensor, schedule, or rule) is mapped to a corresponding HomeKit accessory, with an appropriate service to match the resource type, and an accessory information service.  Each supported Hue bridge resource field is then mapped to a corresponding HomeKit characteristic.

As the [Philips Hue API](https://developers.meethue.com/philips-hue-api) does not support notifications for changes to the Hue bridge state, homebridge-hue polls each Hue bridge's state at a regular interval.  For each Hue bridge field changed, homebridge-hue updates the corresponding HomeKit characteristic.  HomeKit (through homebridge) does notify homebridge-hue of any changes to HomeKit characteristic values.  For each change, homebridge-hue updates the corresponding Hue bridge field.

The polling interval can be set through `heartrate` in `config.json`.  It can also be changed dynamically through the `Output State` characteristic of the bridge `Stateful Programmable Switch` service.  The custom `Last Updated` characteristic shows the last time homebridge-hue refreshed the bridge state.  Note that the iOS 10 [Home](http://www.apple.com/ios/home/) app doesn't support the `Stateful Programmable Switch` service, nor any custom characteristic, so you need to use another HomeKit app for that, see **Caveats** below.

`config.json` contains a key/value-pair for the username per bridge.  When homebridge-hue finds a new bridge, it prompts to press the link button on the bridge.  It then creates a bridge username, and prompts to edit `config.json`, providing the key/value-pair.

## Lights
A Hue bridge light is exposed as a HomeKit accessory with a `Lightbulb` service, with characteristics for `On`, `Brightness`, `Hue`, `Saturation`, `Color Temperature`, and `Status Fault`, depending on the light's features.   Both Philips as well as non-Philips lights are supported.  Note that `Color Temperature` is a custom characteristic, which might not be supported by all HomeKit apps.  It holds the light's colour temperature in Kelvin, from `2000` to `6536`.  `Status Fault` is set when the Hue bridge reports the light as unreachable.  Note that the iOS 10 [Home](http://www.apple.com/ios/home/) app doesn't support this optional characteristic for a `Lightbulb`.

By default homebridge-hue does not expose any lights.  You might want to change this in `config.json` to expose only non-Philips lights, if you have those connected to a v2 (square) Hue Bridge.  You might want to change this to expose all lights, if you have a v1 (round) bridge, or if you want to use the `Color Temperature` characteristic for Living White lights.

## Groups
A Hue bridge group is exposed as a HomeKit accessory with `Lightbulb` service and appropriate characteristics, just as a light.

By default, homebridge-hue does not expose groups.  You might want to change this in `config.json` if you want to use Hue group commands from HomeKit scenes.  As polling the state for group 0 (all lights) requires an additional bridge request, this group can be disabled in `config.json`.  Note that groups of type `Room` are ignored by default.  You can change this by in `config.json`.

## Sensors
A Hue bridge sensor is exposed as a HomeKit accessory with the appropriate service and corresponding characteristic:

- A Hue Tap switch (`ZGPSwitch` sensor) is exposed as a `Stateful Programmable Switch`.  The `Output State` holds the number of the button pressed, `1`, `2`, `3`, or `4`;
- A Hue Dimmer switch (`ZLLSwitch` sensor) is exposed as a `Stateful Programmable Switch`.  The `Output State` holds the number of the button, `1` (On), `2` (Dim Up), `3` (Dim Down), or `4` (Off).  Note that as homebridge-hue cannot reliably detect all dimmer button actions (press, hold, release, release after hold) as it polls the Hue bridge.  Consequently, homebridge-hue only reports the button change once for each press/hold/release series;
- The Hue bridge actually creates three sensors per Hue Motion Sensor, each of which is exposed as a separate HomeKit accessory with the appropriate service: a `Motion Sensor` for the `ZLLPresence` sensor, a `Light Sensor` for the `ZLLLightLevel` sensor and a `Temperature Sensor` for the `ZLLTemperature` sensor.  This probably should have been one accessory with three services.  Note that the `dark` and `daylight` attributes in the `ZLLLightLevel` sensor `state` are not supported;
- The built-in Daylight sensor is exposed a as a `Stateful Programmable Switch`.  I tried exposing this sensor as a regular `Switch` using a read-only `On` characteristic, but the iOS 10 `Home` app ignores the read-only setting.  The `Output State` holds `0` (`false`) or `1` (`true`).  Exposing this sensor was particularly cool under iOS 9, when HomeKit didn't yet support rules on sunrise and sunset.  Under iOS 10 it does, but only from the iOS 10 `Home` app;
- A `CLIPGenericFlag` sensor is exposed as a `Switch`, with an `On` characteristic;
- A `CLIPGenericStatus` sensor is exposed as a `Stateful Programmable Switch`.  The `Output State` holds the `status`, limited to values from `0` to `255`, as it's next to impossible to set a precise value using a slider in the full `int32` range.  When the sensor's `modelid` equals `PHCLGS`, homebridge-hue tries to take the integer value of `swversion` as maximum value.  Note that `modelid` and `swversion` can only be specified when creating the `CLIPGenericStatus` sensor;
- A `CLIPPresence` sensor is exposed as an `Occupancy Sensor`.  So is a `Geofence` sensor;
- A `CLIPTemperature` sensor is exposed as a `Temperature Sensor`;
- A `CLIPHumidity` sensor is exposed as a `Humidity Sensor`;
- I haven't tested the other CLIP sensors, but they should work: `ClipOpenClose` is exposed as a `Contact Sensor`, `CLIPLightLevel` as a `Light Sensor`, and `CLIPSwitch` as a `Stateful Programmable Switch`.

Additionally for each sensor, a custom `Last Updated` characteristic is provided, and, where appropriate, `Battery Level`, `Active`, and `Status Fault` characteristics for the sensor's `config` attributes `battery`, `on`, and `reachable`.  Also note that the iOS 10 [Home](http://www.apple.com/ios/home/) app doesn't support any `Stateful Programmable Switch` service, nor any custom characteristic.

By default homebridge-hue does not expose sensors.  You want to change this in `config.json`, so the sensors can be used as triggers and/or conditions in HomeKit rules.  When you disable CLIP sensors in `config.json`, homebridge-hue exposes only Hue Motions sensors, Hue Dimmer switches, Hue Tap switches, and the built-in Daylight sensor.

## Schedules
A Hue bridge schedule is exposed as a HomeKit `Switch`.

By default, homebridge-hue does not expose schedules.  You might want to change this in `config.json`, to enable or disable schedules from HomeKit.

## Rules
A Hue bridge rule is exposed as a HomeKit `Switch`.

By default, homebridge-hue does not expose rules.  You probably don't want to, but you can change this in `config.json`.  I only use this feature occasionally, when debugging the Hue bridge configuration.  It allows monitoring when bridge rules are triggered and enabling or disabling bridge rules from HomeKit.  Note the 99 bridge accessory limit under **Caveats** below.

## Installation
The homebridge-hue plugin obviously needs homebridge, which, in turn needs Node.js.  I've followed these steps to set it up on my macOS server:

- Install the Node.js JavaScript runtime `node`, from its [website](https://nodejs.org).  I'm using v6.9.4 LTS for macOS (x64), which includes the `npm` package manager;
- Make sure `/usr/local/bin` is in your `$PATH`, as `node`, `npm`, and, later, `homebridge` install there;
- You might want to update `npm` through `sudo npm update -g npm@latest`.  For me, this installs npm version 4.1.1;
- Install homebridge following the instructions on [GitHub](https://github.com/nfarina/homebridge).  For me, this installs homebridge version 0.4.16 to `/usr/local/lib/node_modules`.  Make sure to create a `config.json` in `~/.homebridge`, as described;
- Install the homebridge-hue plugin through `sudo npm install -g homebridge-hue`;
- Edit `~/.homebridge/config.json` and add the `Hue` platform provided by homebridge-hue, see **Configuration** below;
- Run homebridge-hue for the first time, press the link button on (each of) your bridge(s), and note the bridgeid/username pair for each bridge in the log output.  Edit `config.json` to include these, see **Configuration** below.

Once homebridge is up and running with the homebridge-hue plugin, you might want to daemonise it and start it automatically on login or system boot.  See the [homebridge Wiki](https://github.com/nfarina/homebridge/wiki) for more info how to do that on MacOS or on a Raspberri Pi.

## Configuration
In homebridge's `config.json` you need to specify a platform for homebridge-hue:
```
  "platforms": [
    {
      "platform": "Hue",
      "name": "Hue"
    }
  ]
```
The following optional parameters can be added to modify homebridge-hue's behaviour:

- `host`: The hostname or IP address of the Hue bridge.  Default: empty, discover your bridge(s) by querying the Meethue portal.  To specify multiple hostnames and/or IP addresses use an array as value, e.g. `"host": ["192.168.1.10", "192.168.1.11"]`;
- `users`: An object containing a key/value-pair per Hue bridge, where the key holds the bridge ID and the value holds the bridge username, effectively a security token to access the bridge.  Default: empty, when connecting to a new bridge, homebridge-hue will create the username, and prompt you to edit `config.json`;
- `heartrate`: The interval in seconds to poll the Hue bridge.  Default: `5`.  I've been using a 2-second heartrate with no issues on my v2 (square) bridge;
- `timeout`: The timeout in seconds to wait for a response from the Hue bridge (or Meethue portal).  Default: `5`.  You might want to increase this if homebridge-hue reports ESOCKETTIMEDOUT errors;
- `lights`: Flag whether to expose Hue bridge lights to HomeKit.  Default: `false`;
- `philipslights`: Flag whether to include Philips lights when lights are exposed.  Default: `false`, only expose non-Philips lights;
- `alllights`: Deprecated, please use `philipslights` instead.
- `ct`: Flag to expose color temperature similar to the way the v2 (square) Hue bridge does, see [issue #35](https://github.com/ebaauw/homebridge-hue/issues/35).  Default: `false`;
- `groups`: Flag whether to expose Hue bridge groups to HomeKit.  Default: `false`;
- `group0`: Flag whether to include group 0 (all lights) when groups are exposed.  Default: `true`;
- `rooms`: Flag whether to include Rooms when groups are exposed.  Default: `false`;
- `sensors`: Flag whether to expose Hue bridge sensors to HomeKit.  Default: `false`;
- `excludeSensorTypes`: A list of sensor types to ignore.  Default: empty, expose all sensor types.  The sensor type is the (case sensitive) `type` attribute of the bridge sensor object, see **Sensors** above, or "CLIP" as a shortcut for all CLIP sensors.  For example, to expose only the Hue Motion `Motion Sensor` and `Light Level` sensors, specify: `"excludeSensorTypes": [ "CLIP", "Geofence", "Daylight", "ZLLTemperature", "ZLLSwitch", "ZGPSwitch"]`;
- `clipsensors`: Deprecated, please use `"excludeSensorTypes": ["CLIP", "Geofence"]` instead;
- `schedules`: Flag whether to expose Hue bridge schedules to HomeKit.  Default: `false`;
- `rules`: Flag whether to expose Hue bridge rules to HomeKit.  Default: `false`.

For reference, below is an example `config.json` that includes all parameters and their default values:
```
  "platforms": [
    {
      "platform": "Hue",
      "name": "Hue",
      "host": "",
      "users": {
        "001788FFFExxxxxx": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "001788FFFEyyyyyy": "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
      },
      "heartrate": 5,
      "timeout": 5,
      "lights": false,
      "philipslights": false,
      "ct": false,
      "groups": false,
      "group0": true,
      "rooms": false,
      "sensors": false,
      "excludeSensorTypes": [],
      "schedules": false,
      "rules": false
    }
  ]
```

## Troubleshooting
If you run into issues, please run homebridge with only the homebridge-hue plugin enabled in `config.sys`.  This way, you can determine whether the issue is related to the homebridge-hue plugin itself, or to the interaction of multiple homebridge plugins in your setup.  Note that disabling the other plugins from your existing homebridge setup will remove their accessories from HomeKit.  You will need to re-assign these accessories to any HomeKit rooms, groups, scenes, and rules after re-enabling their plugins.  Alternatively, you can start a different instance of homebridge just for homebridge-hue, on a different system, or from a different directory (specified by the `-U` flag).  Make sure to use a different homebridge `name`, `username`, and (if running on the same system) `port` in the `config.sys` for each instance.

The homebridge-hue plugin outputs an info message for each HomeKit characteristic value it sets and for each HomeKit characteristic value change notification it receives.  When homebridge is started with `-D`, homebridge-hue outputs a debug message for each request it makes to the Hue bridge and for each Hue bridge state change it detects.  To capture these messages into a logfile, start homebridge as `homebridge -D > logfile 2>&1`.

To aid troubleshooting, homebridge-hue dumps the full bridge state into a json file, when `Identify` is selected on the bridge accessory.  Bridge ID, mac address, ip address, and usernames are masked.  The file is created in the current directory where homebridge is running, and is named after the bridge.  Note that the iOS 10 [Home](http://www.apple.com/ios/home/) app does not support `Identify`, so you need another HomeKit app for that (see **Caveats** below).

If you need help, please open an issue on [GitHub](https://github.com/ebaauw/homebridge-hue/issues).  Please attach a copy of your full `config.json` (masking any sensitive info), the debug logfile, and the dump of the bridge state.

## Caveats
- The homebridge-hue plugin is a hobby project of mine, provided as-is, with no warranty whatsoever.  I've been running it successfully at my home for months, but your mileage might vary.  Please report any issues on [GitHub](https://github.com/ebaauw/homebridge-hue/issues).
- Homebridge is a great platform, but not really intended for consumers, as it requires command-line interaction.
- HomeKit is still relatively new, and the iOS 10 [Home](http://www.apple.com/ios/home/) app provides only limited support.  You might want to check some other HomeKit apps, like Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) (free), Matthias Hochgatterer's [Home](http://selfcoded.com/home/) (paid), or, if you use `XCode`, Apple's [HMCatalog](https://developer.apple.com/library/content/samplecode/HomeKitCatalog/Introduction/Intro.html#//apple_ref/doc/uid/TP40015048-Intro-DontLinkElementID_2) example app.
- The HomeKit terminology needs some getting used to.  An _accessory_ more or less corresponds to a physical device, accessible from your iOS device over WiFi or Bluetooth.  A _bridge_ (like homebridge) provides access to multiple bridged accessories.  An accessory might provide multiple _services_.  Each service corresponds to a virtual device (like a `Lightbulb`, `Switch`, `Motion Sensor`, ...).  There is also an accessory information service.  Siri interacts with services, not with accessories.  A service contains one or more _characteristics_.  A characteristic is like a service attribute, which might be read or written by HomeKit apps.  You might want to checkout Apple's [HomeKit Accessory Simulator](https://developer.apple.com/library/content/documentation/NetworkingInternet/Conceptual/HomeKitDeveloperGuide/TestingYourHomeKitApp/TestingYourHomeKitApp.html), which is distributed a an additional tool for `XCode`.
- HomeKit only supports 99 bridged accessories per HomeKit bridge (i.e. homebridge, not the Philips Hue bridge).  When homebridge exposes more accessories, HomeKit refuses to pair with homebridge or blocks homebridge if it was paired already.  While homebridge-hue checks that it doesn't expose more than 99 accessories itself, it is unaware of any accessories exposed by other homebridge plugins.  As a workaround to overcome this limit, you can run multiple instances of homebridge with different plugins and/or different homebridge-hue settings, using the `-U` flag to specify a different directory with a different `config.json` for each instance.  Make sure to use a different homebridge `name`, `username`, and `port` for each instance.
- Internally, HomeKit identifies services by UUID.  For Zigbee resources (lights, Hue Tap and Dimmer switches, Hue Motion sensors), homebridge-hue bases this UUID on the unique Zigbee ID.  For non-Zigbee resources, the UUID is based on the Hue bridge ID and resource URI (e.g. `/sensors/1`), not on the resource name (e.g. `Daylight`).  This way, homebridge-hue can deal with duplicate names.  In addition, HomeKit will still recognise the service after the resource name has changed on the Hue bridge, remembering which HomeKit room, scenes, schedules, and rules it belonged to.  However, when a non-Zigbee Hue bridge resource is deleted and then re-created under a different ID, resulting in a different URI, HomeKit will not recognise the new service, and you need to re-add the new service to any HomeKit rooms, scenes, schedules, and rules.

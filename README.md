# homebridge-hue
[![npm](https://img.shields.io/npm/dt/homebridge-hue.svg)](https://www.npmjs.com/package/homebridge-hue) [![npm](https://img.shields.io/npm/v/homebridge-hue.svg)](https://www.npmjs.com/package/homebridge-hue)

## Homebridge plugin for Philips Hue
(C) 2016-2017, Erik Baauw

This [homebridge](https://github.com/nfarina/homebridge) plugin exposes [Philips Hue](http://www2.meethue.com/) bridge lights, groups, sensors, and schedules to Apple's [HomeKit](http://www.apple.com/ios/home/).  It provides the following features:
- HomeKit support for sensors connected to a Hue bridge: Hue motion sensors, Hue dimmer switches, Hue tap switches, the built-in Daylight sensor, and CLIP sensors;
- HomeKit support for all lights connected to a Hue bridge: Philips as well as non-Philips lights.  Support for colour temperature on all _Color temperature lights_ and _Extended color lights_;
- HomeKit support for Hue bridge groups;
- HomeKit support for enabling/disabling Hue bridge sensors, schedules, and rules;
- Monitoring Hue bridges resources (sensors, lights, groups, schedules, and rules) from HomeKit, without the need to refresh the HomeKit app;
- Automatic discovery of Hue bridges; support for multiple Hue bridges; support for both v2 (square) and v1 (round) Hue bridges; works in combination with the HomeKit functionality of the v2 Hue bridge.

## 1. Bridges
The homebridge-hue plugin tries to discover any Hue bridge on your network by querying the Meethue portal.  Alternatively, the hostname(s) or IP address(es) of the Hue bridge(s) can be specified in `config.json`.  Both v2 (square) as well as v1 (round) Hue bridges are supported.

As the [Philips Hue API](https://developers.meethue.com/philips-hue-api) does not support notifications of changes to the Hue bridge state, homebridge-hue polls each Hue bridge for its state at a regular interval, the heartrate.  For each Hue bridge attribute changed, homebridge-hue updates the corresponding HomeKit characteristic.  HomeKit (through homebridge) does notify homebridge-hue of any changes to HomeKit characteristic values.  For each change, homebridge-hue updates the corresponding Hue bridge attribute.

For each bridge, homebridge-hue creates a HomeKit accessory, with a custom service, _Heartbeat_.  This service contains two custom characteristics: `Heartrate` to control the heartrate, and `LastUpdated` that shows the time of the last homebridge-hue refreshed the bridge state.  Note that Apple's [Home](http://www.apple.com/ios/home/) app doesn't support custom services, nor any custom characteristic, so you need to use another HomeKit app for that, see **10. Caveats** below.

Each supported Hue bridge resource is mapped to a corresponding HomeKit accessory, with appropriate service(s) to match the resource type (sensors, lights, groups), or to an additional service for the Hue bridge accessory (schedules, rules).  Each supported Hue bridge resource attribute is then mapped to a corresponding HomeKit characteristic.

### 1.1 Bridge Configuration
By default, homebridge-hue exposes all bridges it discovers.  This discovery is disabled when the bridge hostname(s) or IP address(es) is specified in `config.json`.

The polling interval can be set through `heartrate` in `config.json`.  It can also be changed dynamically through the `Heartrate` characteristic of the bridge _Heartbeat_  service.

`config.json` contains a key/value-pair for the username per bridge.  When homebridge-hue finds a new bridge, it prompts to press the link button on the bridge.  It then creates a bridge username, and prompts to edit `config.json`, providing the key/value-pair.

## 2. Sensors
For each Hue bridge sensor, homebridge-hue creates a HomeKit accessory with the appropriate services and characteristics.

### 2.1 Hue Motion Sensor
The Hue bridge actually uses three sensors per Hue Motion Sensor.  For each of these, homebridge-hue creates a separate HomeKit service:
1. For the `ZLLPresence` bridge sensor, a `Motion Sensor` service is created, with a `Motion Detected` characteristic;
- For the `ZLLLightLevel` bridge sensor, a `Light Sensor` service is created, with characteristics `Light Level`, `Dark`, and `Daylight`.  Note that `Dark` and `Daylight` are custom characteristic types, which might not be supported by all HomeKit apps;
- The `ZLLTemperature` bridge sensor is exposed as a `Temperature Sensor` service, with a `Current Temperature` characteristic.

As of v0.3, homebridge-hue creates a single accessory combining these three services.

Note that homebridge-hue does not support setting the thresholds for `Dark` and `Daylight`; the `tolddark` and `tholdoffset` attributes in the `ZLLLightLevel` bridge sensor `config` are not exposed.  Also homebridge-hue does not yet support setting the sensitivity of the `ZLLPresence` sensor.

### 2.2 Hue Tap and Hue Dimmer Switch
The Hue bridge uses a `ZGPSwitch` sensor per Hue tap and a `ZLLSwitch` sensor per Hue dimmer switch.  For each of these, homebridge-hue creates a separate HomeKit accessory with the following services:

1. Four `Stateless Programmable Switch` services, one for each button, with an `Input Event` characteristic.  As of iOS 10.3, Apple's [Home](http://www.apple.com/ios/home/) app treats this as a four-button programmable switch.  For the Hue dimmer, Button 1 is mapped to _On_, button 2 to _Dim Up_, button 3 to _Dim Down_, and button 4 to _Off_.  The Hue tap supports _Single Press_ per button, the hue dimmer switch _Single Press_ (for press) and _Long Press_ (for hold);
- One custom service, for the sensor status characteristics, see 2.5 below.

Note that iOS 10.3 is still in beta.  The way Apple's [Home](http://www.apple.com/ios/home/) app deals with programmable switches might change and other HomeKit apps might not treat programmable switches in the way Apple's app does.

### 2.3 Daylight Sensor
The built-in `Daylight` sensor is exposed a as an accessory with a `Light Sensor` service and a custom `Daylight` characteristic.  The mandatory `Ambient Light Level` characteristic is set to 100,000 lux during daylight and to 0.0001 lux otherwise.  Apple's [Home](http://www.apple.com/ios/home/) app supports triggers on sunrise and sunset, but HomeKit only supports these as conditions.  The `Daylight` characteristic might come in handy if you want to trigger automation on sunrise or sunset from other HomeKit apps.

### 2.4 CLIP Sensors
Unlike the Hue motion sensor, Hue tap, Hue Dimmer switch, and the built-in Daylight sensor, CLIP sensors are more like Hue bridge variables than actual sensors.  Their values can be set and used from the Hue bridge API as well as in Hue bridge rules.  This makes these sensors extremely useful in home automation scenarios.

Homebridge-hue supports the following CLIP sensors:

Sensor Type | Service | Characteristic | Notes
----------- | ------- | -------------- | -----
`CLIPGenericFlag` | `Switch` | `On`* | Typically used as virtual switch, see the home automation example below.
`CLIPGenericStatus` | _(custom)_ | `Status`* | Typically used to keep state in conjunction with Hue bridge rules, see home automation example below.<br>Note that `Status` is a custom characteristic type, which might not be supported by all HomeKit apps.
`CLIPPresence`<br>`Geofence` | `OccupanySensor` | `OccupancyDetected` | The [Philips Hue](http://www2.meethue.com/en-us/philipshueapp) app uses these extensively for _Home & Away_ routines.
`CLIPTemperature` | `TemperatureSensor` | `CurrentTemperature` | See virtual weather station example below.
`CLIPHumidity` | `HumiditySensor` | `CurrentRelativeHumidity` | See virtual weather station exampl below.
`CLIPOpenClose` | `ContactSensor` | `ContactSensorState` |
`CLIPLightLevel` | `LightSensor` | `LightLevel` |
`CLIPSwitch` | -- | -- | Not supported.
\* These charcteristics can be updated from HomeKit, the other characteristics are read-only.

#### 2.4.1 Home Automation
To turn on the lights and music when entering a room, and to turn them off again when leaving, I use the following setup:
1. A `CLIPGenericFlag` sensor acts as virtual master switch for the room;
- An elaborate set of manually-created Hue bridge rules control this virtual master switch from the Hue motion sensors in the room _and_ in the adjacent rooms.  The state for these rules is maintained in a `CLIPGenericStatus` sensor.  The room only turns off when some-one actually leaves the room, not when we're just sitting still in front of the TV;
- A second set of manually-created Hue bridge rules control the same virtual master switch from a Hue dimmer switch, providing a manual override;
- The virtual master switch is exposed to HomeKit, so it's controlled directly from Siri, and from widgets on our Apple watches and iPhones;
- A third set of manually-created Hue bridge rules control the lights in the room, based on the virtual master switch, the time of day, and the ambient light level (from the Hue motion sensor);
- A set of HomeKit triggers control the Sonos speakers in the room, based on the virtual master switch and the state of the Sonos speakers in the other rooms.  The Sonos speakers are exposed to HomeKit using my other homebridge plugin,  [homebridge-zp](https://github.com/ebaauw/homebridge-zp);
- Another set of HomeKit triggers control a fan, based on the master switch and the room temperature (from the Hue motion sensor).  The fan is made smart through an Eve Energy plug by Elgato, which has native HomeKit support.

#### 2.4.2 Virtual Weather Station
A simpler example is my virtual weather station.  A small cron job retrieves the local temperature and humidity from [Weather Underground](https://www.wunderground.com) using `curl` and stores these values in a `CLIPTemperature` and a `CLIPHumidity` sensor on the Hue bridge, again using `curl`.  These sensors are then exposed to HomeKit.

### 2.5 Sensor Status
For each sensor, homebridge-hue creates the following additional characteristics:
- `LastUpdated` for the sensor's `state` attribute `lastupdated`.  Note that this is a customer characteristic type, which might not be supported by all HomeKit apps;
- `Enabled` for the sensor's config attribute `on`, which allows you to enable or disable the sensor from HomeKit.  To make sure Siri won't unintentionally disable a sensor, homebridge-hue uses a custom characteristic, instead of `Active`;
- `Status Active`, also for the sensor's `config` attribute `on`.  Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) shows a nice warning sign next to the service when it's inactive.
- `Status Fault` for a Zigbee sensor's `config` attribute `reachable`.  Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) shows a nice warning sign next to the service when it's reporting a fault.

To provide these characteristic for programmable switches (Hue dimmer switches and Hue tap switches), an additional custom service is added to the accessory.  Under iOS 10.3, Apple's [Home](http://www.apple.com/ios/home/) app happily ignores this service, so you only see the programmable switch.  Conversely, Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) app hides the `StatelessProgrammableSwitch` services (or rather the `ProgrammableSwitchEvent` characteristic), showing only the custom service in the _Rooms_ view.  It does show the `ProgrammableSwitchEvent` when creating triggers for rules in the _Scenes_ view.

For battery operated Zigbee sensors (the Hue motion sensor and the Hue dimmer switch), homebridge-hue exposes a `BatteryService` service with characteristics `BatteryLevel`, `StatusLowBattery`, and `ChargingState`.  `BatteryLevel` is mapped to the sensor's `config` attribute `battery`.  `StatusLowBattery` is set when the battery level is below 25%.  The mandatory `ChargingState` characteristic is set to _Not Chargeable_.  Note that Apple's [Home](http://www.apple.com/ios/home/) app only shows this service as of iOS 10.3.

### 2.6 Sensor Configuration
By default homebridge-hue does not expose sensors.  You want to change this in `config.json`, so the sensors can be used as triggers and/or conditions in HomeKit rules.  When you disable CLIP sensors in `config.json`, homebridge-hue exposes only Hue Motions sensors, Hue Dimmer switches, Hue Tap switches, and the built-in Daylight sensor.

## 3. Lights
A Hue bridge light is exposed as a HomeKit accessory with a `Lightbulb` service, with characteristics for `On`, `Brightness`, `Hue`, `Saturation`, and `Color Temperature`, depending on the light's features.   Both Philips as well as non-Philips lights are supported.  Note that `Color Temperature` is a custom characteristic type, which might not be supported by all HomeKit apps.  It holds the light's colour temperature in Kelvin, from `2000` to `6536`.

Additionally, a characteristic for `Status Fault` is provided.  It is set when the Hue bridge reports the light as unreachable.  Note that Apple's [Home](http://www.apple.com/ios/home/) app doesn't support this optional characteristic for a `Lightbulb`.  Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) shows a nice warning sign next to the service when it's reporting a fault.

Note that an _On/Off plug-in unit_, is exposed as an accessory with a `Switch` service, with only one characteristic for `On`.  To treat it as a light, set its _Type_ to _Light_ in your HomeKit app.

## 3.1 Color Temperature
Note that the v2 (square) Hue bridge also exposes a custom characteristic for colour temperature as well, but with some limitations:
- It only exposes colour temperature for _Color Temperature Lights_, not for _Extended Color Lights_;
- This `Color Temperature` characteristic holds the value in [Mired](https://en.wikipedia.org/wiki/Mired) (from `153` to `500`) instead of in Kelvin.  Note that Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) app actually converts this value into Kelvin.

By setting `ct` in `config.json`, homebridge-hue exposes colour temperature using the same characteristic type as the Hue bridge.

## 3.2 Light Configuration
By default homebridge-hue does not expose any lights.  You might want to change this in `config.json` to expose only non-Philips lights, if you already expose the Philips lights from your v2 (square) Hue Bridge.  You might want to change this to expose all lights, if you have a v1 (round) bridge, or if you want to use the `Color Temperature` characteristic for Philips _Extended color lights_.

## 3.3 Rooms
From the [Philips Hue](http://www2.meethue.com/en-us/philipshueapp) app, you can synchronise the `Room` groups on the Hue bridge with HomeKit rooms, under _Settings_, _HomeKit & Siri_, _Rooms_.  The app then re-assigns the HomeKit accessories for the lights to the HomeKit rooms, matching the Hue bridge Room groups.  This works for (Philips) lights exposed by the Hue bridge as well as for (non-Philips) lights exposed by homebridge-hue.

## 4. Groups
A Hue bridge group is exposed as a HomeKit accessory with `Lightbulb` service and appropriate characteristics, just as a light.  A group containing only _On/Off plug-in units_ is exposed through a `Switch` service.

In addition to the characteristics uses for lights, an additional characteristic `AnyOn` is provided.

### 4.1 Group Configuration
By default, homebridge-hue does not expose groups.  You might want to change this in `config.json` if you want to use Hue group commands from HomeKit scenes.  As polling the state for group 0 (all lights) requires an additional bridge request, this group can be disabled in `config.json`.  Note that groups of type `Room` are ignored by default.  You can change this by in `config.json`.

## 5. Schedules
A Hue bridge schedule is exposed as an additional custom service to the bridge accessory.  This service contains a single `Enabled` characteristic, mapped to the schedule's `enabled` attribute, which allows you to enable or disable the schedule from HomeKit.  To make sure Siri won't unintentionally disable a schedule, homebridge-hue uses a custom characteristic, instead of `On` or `Active`.

By default, homebridge-hue does not expose schedules.  You might want to change this in `config.json`, to enable or disable schedules from HomeKit.

## 6. Rules
A Hue bridge rule is exposed as an additional custom service to the bridge accessory.  This service contains the follwing custom characteristics:
- `Enabled`, mapped to the rule's `enabled` attribute, which allows you to enable or disable the rule from HomeKit.  To make sure Siri won't unintentionally disable a rule, homebridge-hue uses a custom characteristic, instead of `On` or `Active`;
- `LastUpdated`, mapped to the rule's `lasttriggered` attribute;
- `TimesTriggered`, mapped to the rule's `timestriggered` attribute.

By default, homebridge-hue does not expose rules.  You probably don't want to, but you can change this in `config.json`.  I only use this feature occasionally, when debugging the Hue bridge configuration.  It allows monitoring when bridge rules are triggered and enabling or disabling bridge rules from HomeKit.

Note that HomeKit only supports up to 99 services per accessory, so only the first 98 rules are exposed.  Or fewer, when you also expose schedules.

## 7. Installation

### 7.1 First Install
The homebridge-hue plugin obviously needs homebridge, which, in turn needs Node.js.  I've followed these steps to set it up on my macOS server:

- Install the Node.js JavaScript runtime `node`, from its [website](https://nodejs.org).  I'm using v6.9.4 LTS for macOS (x64), which includes the `npm` package manager;
- Make sure `/usr/local/bin` is in your `$PATH`, as `node`, `npm`, and, later, `homebridge` install there;
- You might want to update `npm` through `sudo npm update -g npm@latest`.  For me, this installs npm version 4.4.1;
- Install homebridge following the instructions on [GitHub](https://github.com/nfarina/homebridge).  For me, this installs homebridge version 0.4.16 to `/usr/local/lib/node_modules`.  Make sure to create a `config.json` in `~/.homebridge`, as described;
- Install the homebridge-hue plugin through `sudo npm install -g homebridge-hue@latest`;
- Edit `~/.homebridge/config.json` and add the `Hue` platform provided by homebridge-hue, see **8. Configuration** below;
- Run homebridge-hue for the first time, press the link button on (each of) your bridge(s), and note the bridgeid/username pair for each bridge in the log output.  Edit `config.json` to include these, see **8. Configuration** below.

### 7.2 Automated Startup
Once homebridge is up and running with the homebridge-hue plugin, you might want to daemonise it and start it automatically on login or system boot.  See the [homebridge Wiki](https://github.com/nfarina/homebridge/wiki) for more info how to do that on MacOS or on a Raspberri Pi.

### 7.3 Updating
Somehow `sudo npm -g update` doesn't always seem to work.  To update homebridge-hue, simply issue another `sudo npm install -g homebridge-hue@latest`.  Please check the [release notes](https://github.com/ebaauw/homebridge-hue/releases) before updating homebridge-hue.  Note that a change to the minor version typically indicates that you need to review/redo you HomeKit configuration.  Due to changes in the mapping how Hue bridge resources are exposed, HomeKit might treat them as a new accessories, services, and/or characteristics, losing any assignment to HomeKit rooms, scenes, actions, and triggers.  To revert to a previous version, specify the version when installing homebridge-hue, as in: `sudo npm install -g homebridge-hue@0.1.14`.

## 8. Configuration
In homebridge's `config.json` you need to specify a platform for homebridge-hue:
```
  "platforms": [
    {
      "platform": "Hue",
      "name": "Hue"
    }
  ]
```
Note that, by default, homebridge-hue exposes the Hue bridge itself, but not the bridge sensors, lights, groups, schedules, and rules.  The following optional parameters can be added to modify this behaviour:

key | default | description
--- | ------- | -----------
`host` | `[]` | The hostname or IP address of the Hue bridge.  When set, discovery of bridges is disabled.  To specify multiple hostnames and/or IP addresses use an array, e.g. `"host": ["192.168.1.10", "192.168.1.11"]`.
`users` | `{}` | A dictionary containing a key/value-pair per Hue bridge, where the key holds the bridge ID and the value holds the bridge username, effectively a security token to access the bridge.  When connecting to a new bridge, homebridge-hue will create the username, and prompt you to edit `config.json`.
`sensors` | `false` | Flag whether to expose Hue bridge sensors to HomeKit.
`excludeSensorTypes` | `[]`| An array of sensor types to ignore.  The sensor type is the (case sensitive) `type` attribute of the bridge sensor object, or `"CLIP"` as a shortcut for all CLIP sensors.  For example, to expose only the Hue motion sensors, Hue taps, and Hue dimmer switches, specify: `"excludeSensorTypes": [ "CLIP", "Geofence", "Daylight"]`.
`lowBattery` | `25` | The battery level threshold for `StatusLowBattery`.
`lights` | `false` | Flag whether to expose Hue bridge lights to HomeKit.
`philipsLights` | `false` | Flag whether to include Philips lights when lights are exposed.  To expose all lights, set `lights` as well as `philipsLights`; to expose only non-Philips lights, only set `lights`.
`ct` | `false` | Flag whether to expose color temperature using the Mirek `Color Temperature` characteristic the v2 (square) Hue bridge uses.
`groups` | `false` | Flag whether to expose Hue bridge groups to HomeKit.
`group0` | `false` | Flag whether to include group 0 (all lights) when groups are exposed.
`rooms` | `false` | Flag whether to include Room groups when groups are exposed.
`schedules` | `false` |lag whether to expose Hue bridge schedules to HomeKit.
`rules` | `false` | Flag whether to expose Hue bridge rules to HomeKit.
`heartrate`| `5` | The interval in seconds to poll the Hue bridge.  Must be between `1` and `30`.  I've been using a 2-second heartrate with no issues on my v2 (square) bridge.  Note that this can be changed dynamically per bridge, through the _Heartbeat_ service.
`waitTimeUpdate` | `50` | The time in milliseconds to wait for a change from HomeKit to another characteristic for the same light or group, before updating the Hue bridge.  Must be between `20` and `500`.  You might want to increase this when homebridge-hue reports `hue bridge error 201: parameter, xy, is not modifiable. Device is set to off.` on activating a HomeKit scene that turns a light on at a specific colour, colour temperature, and/or brightness.
`timeout` | `5` | The timeout in seconds to wait for a response from a Hue bridge (or the Meethue portal or UPnP discovery).  Must be between `5` and `30`.  You might want to increase this if homebridge-hue reports `ESOCKETTIMEDOUT` errors.
`parallelRequests` | `10`<br>`3` | The number of ansynchronous requests homebridge-hue sends in parallel to a Hue bridge.  Must be between `1` and `30`.  You might want to decrease this if homebridge-hue reports `ECONNRESET` errors.  The default is `10` for a v2 bridge and `3` for a v1 bridge.
`waitTimeResend` | `300` | The time in milliseconds to wait before resending a request after an `ECONNRESET` error.  Must be between `100` and `1000`.

### 8.1 Example
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
      "sensors": false,
      "excludeSensorTypes": [],
      "lowBattery": 25,
      "lights": false,
      "philipsLights": false,
      "ct": false,
      "groups": false,
      "group0": false,
      "rooms": false,
      "schedules": false,
      "rules": false,
      "heartrate": 5,
      "waitTimeUpdate": 20,
      "timeout": 5,
      "parallelRequests": 10,
      "waitTimeResend": 300
    }
  ]
```

## 9. Troubleshooting
If you run into homebridge startup issues, please run homebridge with only the homebridge-hue plugin enabled in `config.sys`.  This way, you can determine whether the issue is related to the homebridge-hue plugin itself, or to the interaction of multiple homebridge plugins in your setup.  Note that disabling the other plugins from your existing homebridge setup will remove their accessories from HomeKit.  You will need to re-assign these accessories to any HomeKit room, groups, scenes, actions, and triggers after re-enabling their plugins.  Alternatively, you can start a different instance of homebridge just for homebridge-hue, on a different system, as a different user, or from a different directory (specified by the `-U` flag).  Make sure to use a different homebridge `name`, `username`, and (if running on the same system) `port` in the `config.sys` for each instance.

The homebridge-hue plugin outputs an info message for each HomeKit characteristic value it sets and for each HomeKit characteristic value change notification it receives.  When homebridge is started with `-D`, homebridge-hue outputs a debug message for each request it makes to the Hue bridge and for each Hue bridge state change it detects.  Additionally, it issues a debug message for each bridge resource it detects.  To capture these messages into a logfile, start homebridge as `homebridge -D > logfile 2>&1`.

To aid troubleshooting, homebridge-hue dumps the full bridge state into a json file, when `Identify` is selected on the bridge accessory.  Bridge ID, mac address, ip address, and usernames are masked.  The file is created in the current directory where homebridge is running, and is named after the bridge.  Note that the Apple's [Home](http://www.apple.com/ios/home/) app does not support `Identify`, so you need another HomeKit app for that (see **Caveats** below).

If you need help, please open an issue on [GitHub](https://github.com/ebaauw/homebridge-hue/issues).  Please attach a copy of your full `config.json` (masking any sensitive info), the debug logfile, and the dump of the bridge state.

## 10. Caveats
- The homebridge-hue plugin is a hobby project of mine, provided as-is, with no warranty whatsoever.  I've been running it successfully at my home for months, but your mileage might vary.  Please report any issues on [GitHub](https://github.com/ebaauw/homebridge-hue/issues).
- Homebridge is a great platform, but not really intended for consumers, as it requires command-line interaction.
- HomeKit is still relatively new, and Apple's [Home](http://www.apple.com/ios/home/) app provides only limited support.  You might want to check some other HomeKit apps, like Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) app (free), Matthias Hochgatterer's [Home](http://selfcoded.com/home/) app (paid), or, if you use `XCode`, Apple's [HMCatalog](https://developer.apple.com/library/content/samplecode/HomeKitCatalog/Introduction/Intro.html#//apple_ref/doc/uid/TP40015048-Intro-DontLinkElementID_2) example app.
- The HomeKit terminology needs some getting used to.  An _accessory_ more or less corresponds to a physical device, accessible from your iOS device over WiFi or Bluetooth.  A _bridge_ (like homebridge) is an accesory that provides access to other, bridged, accessories.  An accessory might provide multiple _services_.  Each service corresponds to a virtual device (like a lightbulb, switch, motion sensor, ..., but also: a programmable switch button, accessory information, battery status).  Siri interacts with services, not with accessories.  A service contains one or more _characteristics_.  A characteristic is like a service attribute, which might be read or written by HomeKit apps.  You might want to checkout Apple's [HomeKit Accessory Simulator](https://developer.apple.com/library/content/documentation/NetworkingInternet/Conceptual/HomeKitDeveloperGuide/TestingYourHomeKitApp/TestingYourHomeKitApp.html), which is distributed a an additional tool for `XCode`.
- HomeKit only supports 99 bridged accessories per HomeKit bridge (i.e. homebridge, not the Philips Hue bridge).  When homebridge exposes more accessories, HomeKit refuses to pair with homebridge or it blocks homebridge if it was paired already.  While homebridge-hue checks that it doesn't expose more than 99 accessories itself, it is unaware of any accessories exposed by other homebridge plugins.  As a workaround to overcome this limit, you can run multiple instances of homebridge with different plugins and/or different homebridge-hue settings, using the `-U` flag to specify a different directory with a different `config.json` for each instance.  Make sure to use a different homebridge `name`, `username`, and `port` for each instance.
- Internally, HomeKit identifies services by UUID.  For Zigbee devices (lights, Hue taps, Hue dimmer switches, Hue Motion sensors), homebridge-hue bases this UUID on the unique Zigbee ID.  For non-Zigbee resources, the UUID is based on the Hue bridge ID and resource path (e.g. `/sensors/1`), not on the resource name (e.g. `Daylight`).  This way, homebridge-hue can deal with duplicate names.  In addition, HomeKit will still recognise the service after the resource name has changed on the Hue bridge, remembering which HomeKit room, groups, scenes, actions, and triggers it belonged to.  However, when a non-Zigbee Hue bridge resource is deleted and then re-created, resulting in a different resource path, HomeKit will treat it as a new service, and you will need to re-configure HomeKit.

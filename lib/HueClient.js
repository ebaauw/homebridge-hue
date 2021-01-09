// homebridge-hue/lib/HueClient.js
//
// Homebridge plug-in for Philips Hue and/or deCONZ.
// Copyright © 2018-2021 Erik Baauw. All rights reserved.

'use strict'

const events = require('events')
const homebridgeLib = require('homebridge-lib')
const os = require('os')
const semver = require('semver')

// API errors that could still cause (part of) the PUT command to be executed.
const nonCriticalApiErrorTypes = [
  6, // parameter not available
  7, // invalid value for parameter
  8, // paramater not modifiable
  201 // paramater not modifiable, device is set to off
]

// Estmate the number of Zigbee messages resulting from PUTting body.
function numberOfZigbeeMessages (body) {
  let n = 0
  if (Object.keys(body).includes('on')) {
    n++
  }
  if (
    Object.keys(body).includes('bri') ||
    Object.keys(body).includes('bri_inc')
  ) {
    n++
  }
  if (
    Object.keys(body).includes('xy') ||
    Object.keys(body).includes('ct') ||
    Object.keys(body).includes('hue') ||
    Object.keys(body).includes('sat') ||
    Object.keys(body).includes('effect')
  ) {
    n++
  }
  return n === 0 ? 1 : n
}

/** Hue API error.
  * @hideconstructor
  * @extends HttpClient.HttpError
  * @memberof HueClient
  */
class HueError extends homebridgeLib.HttpClient.HttpError {
  /** The API error type.
    * @type {?integer}
    * @readonly
    */
  get type () {}

  /** The API error description.
    * @type {?string}
    * @readonly
    */
  get description () {}

  /** The API error is non-critical.
    * Part of the PUT command might still be executed.
    * @type {?boolean}
    * @readonly
    */
  get nonCritical () {}
}

/** Hue API response.
  * @hideconstructor
  * @extends HttpClient.HttpResponse
  * @memberof HueClient
  */
class HueResponse extends homebridgeLib.HttpClient.HttpResponse {
  /** An object containing the `"success"` API responses.
    * @type {object}
    * @readonly
    */
  get success () {}

  /** A list of `"error"` API responses.
    * @type {object[]}
    * @readonly
    */
  get errors () {}
}

/** REST API client for Hue bridge, deCONZ gateway, and compatible servers.
  *
  * See the [Hue API](https://developers.meethue.com/develop/get-started-2/)
  * and [deCONZ API](https://dresden-elektronik.github.io/deconz-rest-doc/)
  * documentation for a better understanding of the APIs.
  * @extends HttpClient
  */
class HueClient extends homebridgeLib.HttpClient {
  static get HueError () { return HueError }
  static get HueResponse () { return HueResponse }

  /** Create a new instance of a HueClient.
    *
    * The caller is expected to verify that the given host is a reachable Hue
    * bridge or deCONZ gateway, by calling
    * {@link HueDiscovery#config HueDiscovery#config()} and passing the
    * response as `params.config`.<br>
    * The caller is expected to persist the username (API key),
    * passing it as `params.username`.
    * If no API key is known {@link HueClient#createuser createuser()} can
    * be called to create one.<br>
    * The client is expected to persist the fingerprint of the self-signed SSL
    * certificate of gen-2 Hue bridge, passing it as `params.fingerprint`.
    * If no `fingerprint` is known, it will be pinned on the first request to
    * the Hue bridge, typically the call to
    * {@link HueClient#createuser createuser()}.
    * It can be obtained through the {@link HueClient#fingerprint fingerprint}
    * property.
    *
    * @param {object} params - Parameters.
    * @param {?string} params.config - The bridge/gateway public configuration,
    * i.e. the response of {@link HueDiscovery#config HueDiscovery#config()}.
    * @param {?string} params.fingerprint - The fingerprint of the pinned
    * self-signed SSL certificate of the Hue bridge
    * with firmware v1.24.0 or greater.
    * @param {boolean} [params.forceHttp=false] - Force HTTP instead of HTTPS
    * for Hue bridge with firmware v1.24.0 and greater.
    * @param {!string} params.host - Hostname/IP address and port of the Hue
    * bridge or deCONZ gateway.
    * @param {boolean} [params.keepAlive=false] - Keep server connection(s)
    * open.
    * @param {integer} [params.maxSockets=20] - Throttle requests to maximum
    * number of parallel connections.
    * @param {boolean} [params.phoscon=false] - Mimic Phoscon web app to use
    * deCONZ gateway API extensions.
    * @param {integer} [params.timeout=5] - Request timeout (in seconds).
    * @param {?string} params.username - The API key of the Hue bridge or
    * deCONZ gateway.
    * @param {integer} [params.waitTimePut=50] - The time (in milliseconds),
    * after sending a PUT request, to wait before sending another PUT request.
    * @param {integer} [params.waitTimePutGroup=1000] - The time (in
    * milliseconds), after sending a PUT request, to wait before sending
    * another PUT request.
    * @param {integer} [params.waitTimeResend=300] - The time, in milliseconds,
    * to wait before resending a request after an ECONNRESET, an http status
    * 503, or an api 901 error.
    */
  constructor (params = {}) {
    const _options = {
      keepAlive: false,
      maxSockets: 20,
      timeout: 5,
      waitTimePut: 50,
      waitTimePutGroup: 1000,
      waitTimeResend: 300
    }
    const optionParser = new homebridgeLib.OptionParser(_options)
    optionParser
      .objectKey('config', true)
      .stringKey('fingerprint', true)
      .boolKey('forceHttp')
      .stringKey('host', true)
      .boolKey('keepAlive')
      .intKey('maxSockets', 1, 20)
      .boolKey('phoscon')
      .intKey('timeout', 1, 60)
      .stringKey('username', true)
      .intKey('waitTimePut', 0, 50)
      .intKey('waitTimePutGroup', 0, 1000)
      .intKey('waitTimeResend', 0, 1000)
      .parse(params)
    if (_options.fingerprint != null) {
      _options.https = true
    }
    _options.isDeconz = false
    _options.isHue = false
    if (
      _options.config.bridgeid.substring(0, 6) === '001788' ||
      _options.config.bridgeid.substring(0, 6) === 'ECB5FA'
    ) {
      if (semver.gte(_options.config.apiversion, '1.24.0')) {
        _options.https = true
      }
      _options.isHue = true
    } else if (_options.config.bridgeid.substring(0, 6) === '00212E') {
      _options.isDeconz = true
    }

    const options = {
      host: _options.host,
      json: true,
      keepAlive: _options.keepAlive,
      maxSockets: _options.maxSockets,
      path: '/api',
      timeout: _options.timeout
    }
    if (_options.phoscon) {
      // options.headers = { Accept: 'application/vnd.ddel.v1' }
      options.headers = { Accept: 'application/vnd.ddel.v1.1,vnd.ddel.v1.1' }
    }
    if (_options.username) {
      options.path += '/' + _options.username
    }
    if (_options.https && !_options.forceHttp) {
      options.https = true
      options.selfSignedCertificate = true
    }
    if (_options.isDeconz) {
      options.validStatusCodes = [200, 400, 403, 404]
    }
    super(options)
    this._options = _options
    this.waitForIt = false
    this.setMaxListeners(20)
  }

  /** The ID (Zigbee mac address) of the Hue bridge or deCONZ gateway.
    * @type {string}
    * @readonly
    */
  get bridgeid () { return this._options.config.bridgeid }

  /** The fingerprint of the self-signed SSL certificate of the Hue bridge with
    * firmware v1.24.0 or greater.
    *
    * @type {string}
    */
  get fingerprint () { return this._options.fingerprint }
  set fingerprint (value) { this._options.fingerprint = value }

  /** True when connected to a deCONZ gateway.
    * @type {boolean}
    * @readonly
    */
  get isDeconz () { return this._options.isDeconz }

  /** True when connected to a Hue bridge.
    * @type {boolean}
    * @readonly
    */
  get isHue () { return this._options.isHue }

  /** Server (base) path, `/api/`_username_.
    * @type {string}
    * @readonly
    */
  get path () { return super.path }

  /** The API key.
    * @type {string}
    */
  get username () { return this._options.username }
  set username (value) {
    this._options.username = value
    let path = '/api'
    if (value != null) {
      path += '/' + value
    }
    super.path = path
  }

  // ===========================================================================

  /** Issue a GET request of `/api/`_username_`/`_resource_.
    *
    * @param {string} resource - The resource.<br>
    * This might be a resource as exposed by the API, e.g. `/lights/1/state`,
    * or an attribute returned by the API, e.g. `/lights/1/state/on`.
    * @return {*} response - The JSON response body converted to JavaScript.
    * @throws {HueError} In case of error.
    */
  async get (resource) {
    if (typeof resource !== 'string' || resource[0] !== '/') {
      throw new TypeError(`${resource}: invalid resource`)
    }
    let path = resource.substring(1).split('/')
    switch (path[0]) {
      case 'lights':
        if (path.length === 3 && path[2] === 'connectivity2') {
          path = []
          break
        }
        // falls through
      case 'groups':
        if (path.length >= 3 && path[2] === 'scenes') {
          resource = '/' + path.shift() + '/' + path.shift() + '/' + path.shift()
          if (path.length >= 1) {
            resource += '/' + path.shift()
          }
          break
        }
        // falls through
      case 'schedules':
      case 'scenes':
      case 'sensors':
      case 'rules':
      case 'resourcelinks':
      case 'touchlink':
        if (path.length > 2) {
          resource = '/' + path.shift() + '/' + path.shift()
          break
        }
        path = []
        break
      case 'config':
      case 'capabilities':
        if (path.length > 1) {
          resource = '/' + path.shift()
          break
        }
        // falls through
      default:
        path = []
        break
    }
    let { body } = await this.request('GET', resource)
    for (const key of path) {
      if (typeof body === 'object' && body != null) {
        body = body[key]
      }
    }
    if (body == null && path.length > 0) {
      throw new Error(
        `/${path.join('/')}: not found in resource ${resource}`
      )
    }
    return body
  }

  /** Issue a PUT request to `/api/`_username_`/`_resource_.
    *
    * HueClient throttles the number of PUT requests to limit the Zigbee traffic
    * to 20 unicast messsages per seconds, or 1 broadcast message per second,
    * delaying the request when needed.
    * @param {string} resource - The resource.
    * @param {*} body - The body, which will be converted to JSON.
    * @return {HueResponse} response - The response.
    * @throws {HueError} In case of error, except for non-critical API errors.
    */
  async put (resource, body) {
    if (this.waitForIt) {
      while (this.waitForIt) {
        await events.once(this, '_go')
      }
    }
    const timeout = numberOfZigbeeMessages(body) * (
      resource.startsWith('/groups')
        ? this._options.waitTimePutGroup
        : this._options.waitTimePut
    )
    if (timeout > 0) {
      this.waitForIt = true
      setTimeout(() => {
        this.waitForIt = false
        this.emit('_go')
      }, timeout)
    }
    return this.request('PUT', resource, body)
  }

  /** Issue a POST request to `/api/`_username_`/`_resource_.
    *
    * @param {string} resource - The resource.
    * @param {*} body - The body, which will be converted to JSON.
    * @return {HueResponse} response - The response.
    * @throws {HueError} In case of error.
    */
  async post (resource, body) {
    return this.request('POST', resource, body)
  }

  /** Issue a DELETE request of `/api/`_username_`/`_resource_.
    * @param {string} resource - The resource.
    * @param {*} body - The body, which will be converted to JSON.
    * @return {HueResponse} response - The response.
    * @throws {HueError} In case of error.
    */
  async delete (resource, body) {
    return this.request('DELETE', resource, body)
  }

  // ===========================================================================

  /** Create an API key and set {@link HueClient#username username}.
    *
    * Calls {@link HueClient#post post()} to issue a POST request to `/api`.
    *
    * Before calling `createuser`, the link button on the Hue bridge must be
    * pressed, or the deCONZ gateway must be unlocked.
    * @return {string} username - The newly created API key.
    * @throws {HueError} In case of error.
    */
  async createuser (application) {
    if (typeof application !== 'string' || application === '') {
      throw new TypeError(`${application}: invalid application name`)
    }
    const username = this._options.username
    const body = { devicetype: `${application}#${os.hostname().split('.')[0]}` }
    this.username = null
    try {
      const response = await this.post('/', body)
      this.username = response.success.username
      return this.username
    } catch (error) {
      this.username = username
      throw (error)
    }
  }

  /** Unlock the gateway to allow creating a new API key.
    *
    * Calls {@link HueClient#put put()} to issue a PUT request to
    * `/api/`_username_`/config`.
    * On a Hue bridge, this is the API equivalent of pressing the link button.
    *
    * Note that as of firmware v1.31.0, the gen-2 Hue bridge no longer allows
    * unlocking the bridge through the API.
    * @return {HueResponse} response - The response.
    * @throws {HueError} In case of error.
    */
  async unlock () {
    if (this.isDeconz) {
      return this.put('/config', { unlock: 60 })
    }
    return this.put('/config', { linkbutton: true })
  }

  /** Initiate a touchlink pairing (Hue bridge)
    * or touchlink scan (deCONZ gateway).
    *
    * When connected to a Hue bridge, calls {@link HueClient#put put()} to issue
    * a PUT request to `/api/`_username_`/config` to initiate touchlink pairing.
    * This is the API equivalent of holding the link button on the Hue bridge.
    *
    * Note that deCONZ doesn't support touchlink pairing, only touchlink scan,
    * identify, and reset.
    * When connected to a deCONZ gateway, calls {@link HueClient#post post()}
    * to issue a POST request to `/api/`_username_`/touchlink/scan`,
    * to initiate a touchlink scan.
    * As the ConBee II and RaspBee II firmware lack support for touchlink,
    * this will only work for the original ConBee and RaspBee.
    * To see the results of the scan, issue a GET request of
    * `/api/`_username_`/touchlink/scan`.
    * The ID returned in the scan results is needed to touchlink identify or
    * reset the device.
    * To issue a touchlink identify, issue a POST request of
    * `/api/`_username_`/touchlink/`_ID_`/identify`.
    * To issue a touchlink reset, issue a POST request to
    * `/api/`_username_`/touchlink/`_ID_`/reset`.
    * @return {HueResponse} response - The response.
    * @throws {HueError} In case of error.
    */
  async touchlink () {
    if (this.isDeconz) {
      return this.post('/touchlink/scan')
    }
    return this.put('/config', { touchlink: true })
  }

  /** Search for new devices.
    *
    * When connected to a Hue bridge, calls {@link HueClient#post post()} to
    * issue a POST request to `/api/`_username_`/lights`, to enable pairing of
    * new Zigbee devices.
    *
    * When connected to a deCONZ gateway, calls {@link HueClient#put put()} to
    * issue a PUT request to `/api/`_username_`/config`, to enable pairing of
    * new Zigbee devices.
    *
    * To see the newly paired devices, issue a GET request of
    * `/api/`_username_`/lights/new` and/or `/api/`_username_`/sensor/new`
    * @return {HueResponse} response - The response.
    * @throws {HueError} In case of error.
    */
  async search () {
    if (this.isDeconz) {
      return this.put('/config', { permitjoin: 120 })
    }
    return this.post('/lights')
  }

  /** Restart the bridge or gateway.
    * When connected to a Hue bridge, calls {@link HueClient#put put()} to
    * issue a PUT request to `/api/`_username_`/config`, to reboot the Hue
    * bridge.
    *
    * When connected to a deCONZ gateway, calls {@link HueClient#post post()}
    * to issue a POST request to `/api/`_username_`/config/restartapp`, to
    * restart the deCONZ gateway.
    *
    * @return {HueResponse} response - The response.
    * @throws {HueError} In case of error.
    */
  async restart () {
    if (this.isDeconz) {
      return this.post('/config/restartapp')
    }
    return this.put('/config', { reboot: true })
  }

  // ===========================================================================

  /** Check Hue bridge self-signed SSL certificate
    *
    * @throws {Error} For invalid SSL certificate.
    */
  checkCertificate (cert) {
    if (Object.keys(cert).length > 0) {
      if (this._options.fingerprint != null) {
        if (cert.fingerprint256 !== this._options.fingerprint) {
          throw new Error('SSL certificate fingerprint mismatch')
        }
        return
      }
      if (
        cert.subject == null ||
        cert.subject.C !== 'NL' ||
        cert.subject.O !== 'Philips Hue' ||
        cert.subject.CN.toUpperCase() !== this.bridgeid ||
        cert.issuer == null ||
        cert.issuer.C !== 'NL' ||
        cert.issuer.O !== 'Philips Hue' || (
          cert.issuer.CN.toUpperCase() !== this.bridgeid &&
          cert.issuer.CN !== 'root-bridge'
        ) ||
        ('00' + cert.serialNumber).slice(-16) !== this.bridgeid
      ) {
        throw new Error('invalid SSL certificate')
      }
      // Pin certificate.
      this._options.fingerprint = cert.fingerprint256
    }
  }

  /** Issue an HTTP request to the Hue bridge or deCONZ gateway.
    *
    * This method does the heavy lifting for {@link HueClient#get get()},
    * {@link HueClient#put put()}, {@link HueClient#post post()}, and
    * {@link HueClient#delete delete()}.
    * It shouldn't be called directly.
    *
    * @param {string} method - The method for the request.
    * @param {!string} resource - The resource for the request.
    * @param {?*} body - The body for the request.
    * @return {HueResponse} response - The response.
    * @throws {HueError} In case of error.
    */
  async request (method, resource, body = null) {
    try {
      const response = await super.request(method, resource, body)
      if (response.headers['content-length'] === '0') {
        response.body = null
      }
      response.errors = []
      response.success = {}
      if (Array.isArray(response.body)) {
        for (const id in response.body) {
          const e = response.body[id].error
          if (e != null && typeof e === 'object') {
            response.errors.push({ type: e.type, description: e.description })
            const error = new Error(`api error ${e.type}: ${e.description}`)
            error.request = response.request
            error.type = e.type
            error.description = e.description
            error.nonCritical = nonCriticalApiErrorTypes.includes(error.type)
            /** Emitted for each API error returned by the Hue bridge
              * or deCONZ gateway.
              *
              * @event HueClient#error
              * @param {HueError} error - The error.
              */
            this.emit('error', error)
            if (!error.nonCritical) {
              throw error
            }
          }
          const s = response.body[id].success
          if (s != null && typeof s === 'object') {
            for (const path of Object.keys(s)) {
              const a = path.split('/')
              const key = a[a.length - 1]
              response.success[key] = s[path]
            }
          }
        }
      }
      return response
    } catch (error) {
      if (
        error.code === 'ECONNRESET' ||
        error.statusCode === 503 ||
        error.type === 901
      ) {
        if (error.request != null && this._options.waitTimeResend > 0) {
          error.message += ' - retry in ' + this._options.waitTimeResend + 'ms'
          this.emit('error', error)
          await homebridgeLib.timeout(this._options.waitTimeResend)
          return this.request(method, resource, body)
        }
      }
      throw error
    }
  }
}

module.exports = HueClient

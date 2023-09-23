// homebridge-hue/lib/HueDiscovery.js
//
// Homebridge plug-in for Philips Hue and/or deCONZ.
// Copyright © 2018-2023 Erik Baauw. All rights reserved.

'use strict'

const events = require('events')
const {
  Bonjour, HttpClient, OptionParser, UpnpClient, timeout
} = require('homebridge-lib')
const xml2js = require('xml2js')

/** Class for discovery of Hue bridges and deCONZ gateways.
  *
  * See the [Hue API](https://developers.meethue.com/develop/get-started-2/)
  * and [deCONZ API](https://dresden-elektronik.github.io/deconz-rest-doc/)
  * documentation for a better understanding of the APIs.
  * @extends EventEmitter
  */
class HueDiscovery extends events.EventEmitter {
  /** Create a new instance.
    * @param {object} params - Parameters.
    * @param {boolean} [params.forceHttp=false] - Use plain HTTP instead of HTTPS.
    * @param {integer} [params.timeout=5] - Timeout (in seconds) for requests.
    */
  constructor (params = {}) {
    super()
    this._options = {
      forceHttp: false,
      timeout: 5
    }
    const optionParser = new OptionParser(this._options)
    optionParser.boolKey('forceHttp')
    optionParser.intKey('timeout', 1, 60)
    optionParser.parse(params)
  }

  /** Issue an unauthenticated GET request of `/api/config` to given host.
    *
    * @param {string} host - The IP address or hostname and port of the Hue
    * bridge or deCONZ gateway.
    * @return {object} response - The JSON response body converted to JavaScript.
    * @throws {HttpError} In case of error.
    */
  async config (host) {
    const client = new HttpClient({
      host,
      json: true,
      path: '/api',
      timeout: this._options.timeout
    })
    client
      .on('error', (error) => {
        /** Emitted when an error has occured.
          *
          * @event HueDiscovery#error
          * @param {HttpError} error - The error.
          */
        this.emit('error', error)
      })
      .on('request', (request) => {
        /** Emitted when request has been sent.
          *
          * @event HueDiscovery#request
          * @param {HttpRequest} request - The request.
          */
        this.emit('request', request)
      })
      .on('response', (response) => {
        /** Emitted when a valid response has been received.
          *
          * @event HueDiscovery#response
          * @param {HttpResponse} response - The response.
          */
        this.emit('response', response)
      })
    const { body, request } = await client.get('/config')
    if (
      body == null || typeof body !== 'object' ||
      typeof body.apiversion !== 'string' ||
      !/[0-9A-Fa-f]{16}/.test(body.bridgeid) ||
      typeof body.name !== 'string' ||
      typeof body.swversion !== 'string'
    ) {
      const error = new Error('invalid response')
      error.request = request
      this.emit('error', error)
      throw error
    }
    return body
  }

  /** Issue an unauthenticated GET request of `/description.xml` to given host.
    *
    * @param {string} host - The IP address or hostname and port of the Hue
    * bridge or deCONZ gateway.
    * @return {object} response - The description, converted to JavaScript.
    * @throws {Error} In case of error.
    */
  async description (host) {
    const options = {
      host,
      timeout: this._options.timeout
    }
    const client = new HttpClient(options)
    client
      .on('error', (error) => { this.emit('error', error) })
      .on('request', (request) => { this.emit('request', request) })
      .on('response', (response) => { this.emit('response', response) })
    const { body } = await client.get('/description.xml')
    const xmlOptions = { explicitArray: false }
    const result = await xml2js.parseStringPromise(body, xmlOptions)
    return result
  }

  /** Discover Hue bridges and/or deCONZ gateways.
    *
    * Queries the MeetHue and Phoscon portals for known bridges / gateways and
    * does a local search over mDSN (Bonjour) and UPnP.
    * Calls {@link HueDiscovery#config config()} for each discovered bridge or
    * gateway for verification.
    * @param {object} params - Parameters.
    * @param {boolean} [params.stealth=false] - Don't query discovery portals.
    * @param {boolean} [params.noDeconz=false] - Don't discover deCONZ gateways.
    * @return {object} response - Response object with a key/value pair per
    * found bridge / gateway.  The key is the host (IP address or hostname and
    * port), the value is the return value of
    * {@link HueDiscovery#config config()}.
    */
  async discover (params = {}) {
    this.bridgeMap = {}
    this.jobs = []
    this.jobs.push(this._bonjour())
    if (!params.noDeconz) {
      this.jobs.push(this._upnp())
    }
    if (!params.stealth) {
      this.jobs.push(this._nupnp({
        name: 'meethue.com',
        https: !this._options.forceHttp,
        host: 'discovery.meethue.com'
      }))
      if (!params.noDeconz) {
        this.jobs.push(this._nupnp({
          name: 'phoscon.de',
          https: !this._options.forceHttp,
          host: 'phoscon.de',
          path: '/discover'
        }))
      }
    }
    for (const job of this.jobs) {
      await job
    }
    return this.bridgeMap
  }

  _found (name, id, host) {
    /** Emitted when a potential bridge or gateway has been found.
      * @event HueDiscovery#found
      * @param {string} name - The name of the search method.
      * @param {string} bridgeid - The ID of the bridge or gateway.
      * @param {string} host - The IP address/hostname and port of the bridge
      * or gateway.
      */
    this.emit('found', name, id, host)
    if (this.bridgeMap[host] == null) {
      this.bridgeMap[host] = id
      this.jobs.push(
        this.config(host).then((config) => {
          this.bridgeMap[host] = config
        }).catch((error) => {
          delete this.bridgeMap[host]
          if (error.request == null) {
            this.emit('error', error)
          }
        })
      )
    }
  }

  async _bonjour () {
    const bonjour4 = new Bonjour()
    this.emit('searching', 'mdns', '224.0.0.251:5353')
    const browser4 = bonjour4.find({ type: 'hue' })
    browser4.on('up', (obj) => {
      this._found('bonjour', obj.txt.bridgeid.toUpperCase(), obj.referer.address)
    })
    await timeout(this._options.timeout * 1000)
    this.emit('searchDone', 'mdns')
    bonjour4.destroy()
  }

  async _upnp () {
    const upnpClient = new UpnpClient({
      filter: (message) => {
        return /^[0-9A-F]{16}$/.test(message['hue-bridgeid'])
      },
      timeout: this._options.timeout
    })
    upnpClient
      .on('error', (error) => { this.emit('error', error) })
      .on('searching', (host) => {
        /** Emitted when UPnP search has started.
          *
          * @event HueDiscovery#searching
          * @param {string} host - The IP address and port from which the
          * search was started.
          */
        this.emit('searching', 'upnp', host)
      })
      .on('request', (request) => {
        request.name = 'upnp'
        this.emit('request', request)
      })
      .on('deviceFound', (address, obj, message) => {
        let host
        const a = obj.location.split('/')
        if (a.length > 3 && a[2] != null) {
          host = a[2]
          const b = host.split(':')
          const port = parseInt(b[1])
          if (port === 80) {
            host = b[0]
          }
          this._found('upnp', obj['hue-bridgeid'], host)
        }
      })
    upnpClient.search()
    await events.once(upnpClient, 'searchDone')
    /** Emitted when UPnP search has concluded.
      *
      * @event HueDiscovery#searchDone
      * @param {string} name - The name of the search method.
      */
    this.emit('searchDone', 'upnp')
  }

  async _nupnp (options) {
    options.json = true
    options.timeout = this._options.timeout
    const client = new HttpClient(options)
    client
      .on('error', (error) => { this.emit('error', error) })
      .on('request', (request) => { this.emit('request', request) })
      .on('response', (response) => { this.emit('response', response) })
    try {
      const { body } = await client.get()
      if (Array.isArray(body)) {
        for (const bridge of body) {
          let host = bridge.internalipaddress
          if (bridge.internalport != null && bridge.internalport !== 80) {
            host += ':' + bridge.internalport
          }
          this._found(options.name, bridge.id.toUpperCase(), host)
        }
      }
    } catch (error) {
      if (error instanceof HttpClient.HttpError) {
        return
      }
      this.emit('error', error)
    }
  }
}

module.exports = HueDiscovery

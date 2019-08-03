// homebridge-hue/lib/HueClient.js
//
// Homebridge plug-in for Philips Hue and/or deCONZ.
// Copyright © 2018-2019 Erik Baauw. All rights reserved.
//
// Philips Hue API client connection.

'use strict'

const debug = require('debug')
const homebridgeLib = require('homebridge-lib')
const os = require('os')
const request = require('request')
const semver = require('semver')
const xml2js = require('xml2js')

let id = 0

/** Hue (compatible) API client.
  */
class HueClient {
  /** Create a new HueClient instance.
    */
  constructor (options = {}) {
    this._debug = debug('HueClient' + ++id)
    this._debug('constructor(%j)', options)
    this._options = {
      hostname: 'localhost',
      port: 80,
      timeout: 5
    }
    const optionParser = new homebridgeLib.OptionParser(this._options)
    optionParser.stringKey('bridgeid', true)
    optionParser.hostKey()
    optionParser.stringKey('fingerprint', true)
    optionParser.boolKey('phoscon')
    optionParser.stringKey('username', true)
    optionParser.intKey('timeout', 1, 60)
    optionParser.parse(options)
    if (this._options.fingerprint != null) {
      this._options.https = true
    }
    this._options.url = this._options.https ? 'https://' : 'http://'
    this._options.url += this._options.hostname
    if (this._options.port !== 80) {
      this._options.url += ':' + this._options.port
    }
    this._debug('constructor() => %j', this._options)
  }

  // Return the bridgeid
  get bridgeid () {
    return this._options.bridgeid
  }

  // Return the fingerprint of the bridge SSL certificate.
  get fingerprint () {
    return this._options.fingerprint
  }

  // Return true iff connected to a deCONZ gateway.
  get isDeconz () {
    return this._options.isDeconz
  }

  // Return true iff connected to a Hue bridge.
  get isHue () {
    return this._options.isHue
  }

  /** Connect to Hue bridge or deCONZ gateway or compatible API.
    */
  async connect () {
    this._debug('connect()')
    const config = await this.config()
    if (this._options.bridgeid == null) {
      this._options.bridgeid = config.bridgeid
    } else if (config.bridgeid !== this._options.bridgeid) {
      throw new Error('bridgeid mismatch')
    }
    if (
      config.bridgeid.substring(0, 6) === '001788' ||
      config.bridgeid.substring(0, 6) === 'ECB5FA'
    ) {
      if (semver.gte(config.apiversion, '1.24.0')) {
        this._options.https = true
      }
      this._options.isHue = true
    } else if (config.bridgeid.substring(0, 6) === '00212E') {
      this._options.isDeconz = true
    }
    this._options.url = this._options.https ? 'https://' : 'http://'
    this._options.url += this._options.hostname
    if (this._options.port !== 80) {
      this._options.url += ':' + this._options.port
    }
    this._debug('connect() => %j', this._options)
  }

  // ===========================================================================

  // Retrieve resource.
  async get (resource) {
    this._debug('get(%j)', resource)
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
        if (path[0] === 'groups' && path.length >= 3 && path[2] === 'scenes') {
          if (path.length >= 4) {
            resource = '/' + path.shift() + '/' + path.shift() +
                       '/' + path.shift() + '/' + path.shift()
            break
          }
          resource = '/' + path.shift() + '/' + path.shift() +
                     '/' + path.shift()
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
    let response = await this._request('GET', resource)
    for (const key of path) {
      if (typeof response === 'object' && response != null) {
        response = response[key]
      }
    }
    if (response == null && path.length > 0) {
      throw new Error(
        `/${path.join('/')}: not found in resource ${resource}`
      )
    }
    this._debug('get(%j, %j) => %j', resource, path, response)
    return response
  }

  // Update resource.
  async put (resource, body) {
    this._debug('put(%j, %j)', resource, body)
    const response = await this._request('PUT', resource, body)
    this._debug('put(%j, %j) => %j', resource, body, response)
    if (Array.isArray(response)) {
      const result = {}
      for (const id in response) {
        const obj = response[id].success
        if (obj) {
          const key = Object.keys(obj)[0]
          const path = key.split('/')
          result[path[path.length - 1]] = obj[key]
        }
      }
      return result
    }
    return response
  }

  // Create resource.
  async post (resource, body) {
    this._debug('post(%j, %j)', resource, body)
    const response = await this._request('POST', resource, body)
    this._debug('post(%j, %j) => %j', resource, body, response)
    if (Array.isArray(response) && response[0] && response[0].success) {
      const obj = response[0].success
      if (typeof obj === 'object' && obj != null) {
        const key = Object.keys(obj)[0]
        const resp = {}
        resp[key] = obj[key]
        return resp
      }
    }
    return response
  }

  // Delete resource.
  async delete (resource, body) {
    this._debug('delete(%j, %j)', resource, body)
    const response = await this._request('DELETE', resource, body)
    this._debug('delete(%j, %j) => %j', resource, body, response)
    if (Array.isArray(response) && response[0] && response[0].success) {
      const s = response[0].success
      if (typeof s === 'string' && s.split(' ').length === 2) {
        return s.split(' ')[0]
      }
    }
    return response
  }

  // ===========================================================================

  // Do an unauthenticated get of /config and cache the result.
  async config () {
    this._debug('getConfig()')
    if (this._config == null) {
      const username = this._options.username
      this._options.username = null
      this._config = await this.get('/config')
      this._options.username = username
    }
    this._debug('getConfig() => %j', this._config)
    return this._config
  }

  // Get the description.xml, converted to json.
  async description () {
    return new Promise((resolve, reject) => {
      const requestObj = {
        method: 'GET',
        headers: { Connection: 'keep-alive' },
        url: `${this._options.url}/description.xml`,
        timeout: 1000 * this._options.timeout
      }
      if (this._options.https) {
        // Don't check validity of self-signed Hue bridge certificate
        requestObj.strictSSL = false
      }
      request(requestObj, (error, response) => {
        if (error) {
          return reject(error)
        }
        if (response.statusCode !== 200) {
          return reject(new Error(`http status ${response.statusCode}`))
        }
        const xmlOptions = { explicitArray: false }
        xml2js.parseString(response.body, xmlOptions, (error, result) => {
          if (error) {
            return reject(error)
          }
          return resolve(result)
        })
      })
    })
  }

  // ===========================================================================

  // Create a username.
  async createuser (application) {
    if (typeof application !== 'string' || application === '') {
      throw new TypeError(`${application}: invalid application name`)
    }
    this._debug('createUsername(%j)', application)
    const username = this._options.username
    const body = { devicetype: `${application}#${os.hostname().split('.')[0]}` }
    this._options.username = null
    try {
      const response = await this.post('/', body)
      this._options.username = response.username
      this._debug('createUsername() => %j', this._options.username)
      return this._options.username
    } catch (err) {
      this._options.username = username
      throw (err)
    }
  }

  // Unlock the gateway to allow creating a new username.
  async unlock () {
    if (await this.isDeconz()) {
      return this.put('/config', { unlock: 60 })
    }
    return this.put('/config', { linkbutton: true })
  }

  // Initiate a touchlink.
  async touchlink () {
    if (await this.isDeconz()) {
      return this.post('/touchlink/scan')
    }
    return this.put('/config', { touchlink: true })
  }

  // Search for new devices.
  async search () {
    if (await this.isDeconz()) {
      return this.put('/config', { permitjoin: 120 })
    }
    return this.post('/lights')
  }

  // ===========================================================================

  // Check Hue bridge SSL certificate
  _checkCertificate (cert) {
    if (Object.keys(cert).length > 0) {
      if (
        cert.subject == null ||
        cert.subject.C !== 'NL' ||
        cert.subject.O !== 'Philips Hue' ||
        cert.subject.CN.toUpperCase() !== this._options.bridgeid ||
        cert.issuer == null ||
        cert.issuer.C !== 'NL' ||
        cert.issuer.O !== 'Philips Hue' || (
          cert.issuer.CN.toUpperCase() !== this._options.bridgeid &&
          cert.issuer.CN !== 'root-bridge'
        ) ||
        ('00' + cert.serialNumber).substr(-16) !== this._options.bridgeid
      ) {
        this._debug('certificate: %j', cert)
        throw new Error('invalid SSL certificate')
      }
      if (this._options.fingerprint == null) {
        this._options.fingerprint = cert.fingerprint256
        this._debug('fingerprint: %s', this._options.fingerprint)
      } else if (cert.fingerprint256 !== this._options.fingerprint) {
        throw new Error('SSL certificate fingerprint mismatch')
      }
    }
  }

  // Issue REST API request to bridge/gateway.
  async _request (method, resource, body = null) {
    const methods = ['GET', 'PUT', 'POST', 'DELETE']
    if (!methods.includes(method)) {
      throw new TypeError(`${method}: invalid method`)
    }
    resource = homebridgeLib.OptionParser.toPath('resource', resource, true)
    if (body != null) {
      body = homebridgeLib.OptionParser.toObject('body', body)
    }
    return new Promise((resolve, reject) => {
      let url = this._options.url + '/api'
      if (this._options.username != null) {
        url += '/' + this._options.username
      }
      const requestObj = {
        method: method,
        url: url + resource,
        headers: { Connection: 'keep-alive' },
        timeout: 1000 * this._options.timeout,
        json: true
      }
      if (this._options.phoscon) {
        requestObj.headers['Accept'] = 'application/vnd.ddel.v1'
      }
      if (body) {
        requestObj.body = body
      }
      if (this._options.https) {
        // Don't check validity of self-signed Hue bridge certificate
        requestObj.strictSSL = false
      }
      this._debug('request(%j)', requestObj)
      request(requestObj, (error, response) => {
        this._debug('request(%j) => %j', requestObj, response)
        if (error) {
          return reject(error)
        }
        if (this._options.https) {
          try {
            this._checkCertificate(response.socket.getPeerCertificate())
          } catch (error) {
            reject(error)
          }
        }
        if (Array.isArray(response.body)) {
          for (const id in response.body) {
            const e = response.body[id].error
            if (e) {
              return reject(new Error(`${e.type} ${e.description}`))
            }
          }
        }
        if (response.statusCode !== 200) {
          return reject(new Error(`http status ${response.statusCode}`))
        }
        return resolve(response.body)
      })
    })
  }
}

module.exports = HueClient

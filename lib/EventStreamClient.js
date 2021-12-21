// homebridge-hue/lib/EventStreamClient.js
//
// Homebridge plug-in for Philips Hue and/or deCONZ.
// Copyright © 2021 Erik Baauw. All rights reserved.

'use strict'

const events = require('events')
const https = require('https')
const homebridgeLib = require('homebridge-lib')

const HueClient = require('./HueClient')
const { HttpError } = HueClient

const timeout = 5

/** Client for Hue API v2 event stream notifications.
  *
  * See the
  * [Hue API v2](https://developers.meethue.com/develop/hue-api-v2/migration-guide-to-the-new-hue-api/)
  * documentation for a better understanding of the event stream notifications.
  * @copyright © 2021 Erik Baauw. All rights reserved.
  */
class EventStreamClient extends events.EventEmitter {
  /** Create a new web socket client instance.
    * @param {object} params - Parameters.
    * @param {integer} [params.retryTime=10] - Time (in seconds) to try and
    * reconnect when the server connection has been closed.
    * @param {boolean} [params.raw=false] - Issue raw events instead of parsing
    * them.<br>
    * When specified, {@link WsMonitor#event:notification notification}
    * events are emitted, in lieu of {@link WsMonitor#event:changed changed},
    * {@link WsMonitor#event:added added}, and
    * {@link WsMonitor#event:sceneRecall sceneRecall} events.
    */
  constructor (client, params = {}) {
    super()
    if (!(client instanceof HueClient)) {
      throw new TypeError('client: not a HueClient')
    }
    this.options = {
      client: client,
      retryTime: 10,
      resource: '/eventstream/clip/v2',
      url: 'https://' + client.host
    }
    const optionParser = new homebridgeLib.OptionParser(this.options)
    optionParser
      .boolKey('raw')
      .intKey('retryTime', 0, 120)
      .parse(params)
  }

  /** Initialise the event stream client.
    */
  async init () {
    if (this.buttonMap == null) {
      // Setup an HTTP client for API v2.
      const client = new homebridgeLib.HttpClient({
        headers: {
          'hue-application-key': this.options.client.username
        },
        host: this.options.client.host,
        https: true,
        json: true,
        path: '/clip/v2',
        selfSignedCertificate: true,
        timeout: timeout
      })
      client
        .on('error', (error) => { this.emit('error', error) })
        .on('request', (request) => { this.emit('request', request) })
        .on('response', (response) => { this.emit('response', response) })
        .on('timeout', (timeout) => { this.emit('timeout', timeout) })

      // Get the API v2 button IDs
      const response = await client.get('/resource/button')

      // Build a map to convert ID to buttonevent.
      this.buttonMap = {}
      for (const button of response.body.data) {
        this.buttonMap[button.id] = button.metadata.control_id * 1000
      }
      this.requestId = 1
    }
  }

  /** Listen for web socket notifications.
    */
  listen () {
    this.request = https.request(this.options.url + this.options.resource, {
      family: 4,
      headers: {
        'hue-application-key': this.options.client.username,
        Accept: 'text/event-stream'
      },
      method: 'GET',
      keepAlive: true,
      rejectUnauthorized: false
    })
    const requestInfo = {
      name: this.options.client.name,
      id: ++this.requestId,
      method: 'GET',
      resource: this.options.resource,
      url: this.options.url + this.options.resource
    }
    this.request
      .on('error', (error) => {
        if (!(error instanceof HttpError)) {
          error = new HttpError(error.message, requestInfo)
        }
        this.emit('error', error)
      })
      .on('socket', (socket) => {
        this.emit('request', requestInfo)
        socket
          .setKeepAlive(true)
          .on('close', async () => {
            try {
              await this.close(true)
            } catch (error) { this.emit('error', error) }
          })
      })
      .on('response', (response) => {
        try {
          this.options.client.checkCertificate(response.socket.getPeerCertificate())
        } catch (error) {
          this.request.destroy(error)
          return
        }
        this.emit('response', {
          statusCode: 200,
          statusMessage: 'OK',
          request: requestInfo
        })
        this.listening = true
        /** Emitted when the connection to the event stream has been opened.
          * @event EventStreamClient#listening
          * @param {string} url - The URL of the event stream.
          */
        this.emit('listening', this.options.url + this.options.resource)
        let s = ''
        response
          .on('data', (buffer) => {
            try {
              s += buffer.toString('utf-8')
              if (s.slice(-2) !== '\n\n') {
                return
              }
              s = s.trim()
              this.emit('data', s)
              const lines = s.split('\n')
              s = ''
              for (const line of lines) {
                const a = line.split(': ')
                if (a[0] === 'data') {
                  // TODO check if we need to handle incomplete data
                  const container = JSON.parse(a[1])
                  if (this.options.raw) {
                    this.emit('notification', container)
                  } else {
                    this.parseContainer(container)
                  }
                }
              }
            } catch (error) { this.emit('error', error) }
          })
      })
    this.request.end()
  }

  /** Close the event stream.
    */
  async close (retry = false) {
    if (this.request != null) {
      this.request.destroy()
      this.request.removeAllListeners()
      delete this.request
    }
    if (this.listening) {
      /** Emitted when the connection to the event stream has been closed.
        * @event EventStreamClient#closed
        * @param {string} url - The URL of the event stream.
        */
      this.emit('closed', this.options.url + this.options.resource)
      this.listening = false
    }
    if (retry && this.options.retryTime > 0) {
      await homebridgeLib.timeout(this.options.retryTime * 1000)
      this.listen()
    }
  }

  parseContainer (container) {
    for (const obj of container) {
      switch (obj.type) {
        case 'update':
          this.parseUpdate(obj)
          break
        default:
          this.emit('notification', obj)
          break
      }
    }
  }

  parseUpdate (obj) {
    for (const data of obj.data) {
      const resource = data.id_v1
      const state = {}
      const config = {}
      for (const key of Object.keys(data)) {
        const value = data[key]
        switch (key) {
          case 'on':
            state.on = value.on
            break
          case 'dimming':
            state.bri = Math.round(value.brightness * 2.54)
            break
          case 'color':
            state.xy = [value.xy.x, value.xy.y]
            break
          case 'color_temperature':
            if (value.mirek_valid) {
              state.ct = value.mirek
            }
            break
          case 'status':
            if (resource.startsWith('/sensors')) {
              config.reachable = value === 'connected'
            } else {
              state.reachable = value === 'connected'
            }
            break
          case 'button':
            state.buttonevent = this.buttonMap[data.id] + {
              initial_press: 0,
              repeat: 1,
              short_release: 2,
              long_release: 3
            }[value.last_event]
            state.lastupdated = obj.creationtime.slice(0, -1)
            break
          case 'motion':
            if (value.motion_valid) {
              state.presence = value.motion
              state.lastupdated = obj.creationtime.slice(0, -1)
            }
            break
          case 'light':
            if (value.light_level_valid) {
              state.lightlevel = value.light_level
              state.lastupdated = obj.creationtime.slice(0, -1)
            }
            break
          case 'temperature':
            if (value.temperature_valid) {
              state.temperature = Math.round(value.temperature * 100)
              state.lastupdated = obj.creationtime.slice(0, -1)
            }
            break
          case 'enabled':
            config.on = value
            break
          default:
            break
        }
      }
      let emitted = false
      if (Object.keys(state).length > 0) {
        this.emit('changed', resource + '/state', state)
        emitted = true
      }
      if (Object.keys(config).length > 0) {
        this.emit('changed', resource + '/config', config)
        emitted = true
      }
      if (!emitted) {
        this.emit('notification', obj)
      }
    }
  }
}

module.exports = EventStreamClient

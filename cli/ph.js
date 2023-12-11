#!/usr/bin/env node

// homebridge-hue/cli/ph.js
//
// Homebridge plug-in for Philips Hue.
// Copyright © 2018-2023 Erik Baauw. All rights reserved.
//
// Command line interface to Philips Hue API.

'use strict'

const fs = require('fs')
const HueClient = require('../lib/HueClient')
const HueDiscovery = require('../lib/HueDiscovery')
const {
  CommandLineParser, CommandLineTool, JsonFormatter, OptionParser
} = require('hb-lib-tools')
const packageJson = require('../package.json')

const { b, u } = CommandLineTool
const { UsageError } = CommandLineParser

const usage = {
  ph: `${b('ph')} [${b('-hVD')}] [${b('-H')} ${u('hostname')}] [${b('-u')} ${u('username')}] [${b('-t')} ${u('timeout')}] ${u('command')} [${u('argument')} ...]`,

  get: `${b('get')} [${b('-hsnjuatlkv')}] [${u('path')}]`,
  put: `${b('put')} [${b('-hv')}] ${u('resource')} [${u('body')}]`,
  post: `${b('post')} [${b('-hv')}] ${u('resource')} [${u('body')}]`,
  delete: `${b('delete')} [${b('-hv')}] ${u('resource')} [${u('body')}]`,

  eventlog: `${b('eventlog')} [${b('-hnrs')}]`,

  discover: `${b('discover')} [${b('-hS')}]`,
  config: `${b('config')} [${b('-hs')}]`,
  description: `${b('description')} [${b('-hs')}]`,
  createuser: `${b('createuser')} [${b('-hv')}]`,
  unlock: `${b('unlock')} [${b('-hv')}]`,
  touchlink: `${b('touchlink')} [${b('-hv')}]`,
  search: `${b('search')} [${b('-hv')}]`,

  outlet: `${b('outlet')} [${b('-hv')}]`,
  switch: `${b('switch')} [${b('-hv')}]`,
  probe: `${b('probe')} [${b('-hv')}] [${b('-t')} ${u('timeout')}] ${u('light')}`,
  restart: `${b('restart')} [${b('-hv')}]`
}
const description = {
  ph: 'Command line interface to Philips Hue API.',

  get: `Retrieve ${u('path')} from bridge/gateway.`,
  put: `Update ${u('resource')} on bridge/gateway with ${u('body')}.`,
  post: `Create ${u('resource')} on bridge/gateway with ${u('body')}.`,
  delete: `Delete ${u('resource')} from bridge/gateway with ${u('body')}.`,

  eventlog: 'Log events from the Hue API v2 event stream.',

  discover: 'Discover Hue bridges.',
  config: 'Retrieve Hue bridge configuration (unauthenticated).',
  description: 'Retrieve Hue bridge description.',
  createuser: 'Create Hue bridge API username.',
  unlock: 'Unlock Hue bridge so a new API username can be created.',
  touchlink: 'Initiate a touchlink.',
  search: 'Initiate a seach for new devices.',

  outlet: 'Create/update outlet resourcelink.',
  switch: 'Create/update switch resourcelink.',
  probe: `Probe ${u('light')} for supported colour (temperature) range.`,
  restart: 'Restart Hue bridge.'
}
const help = {
  ph: `${description.ph}

Usage: ${usage.ph}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-V')}, ${b('--version')}
  Print version and exit.

  ${b('-D')}, ${b('--debug')}
  Print debug messages for communication with the Hue bridge.

  ${b('-H')} ${u('hostname')}, ${b('--host=')}${u('hostname')}
  Connect to ${u('hostname')}.

  ${b('-u')} ${u('username')}, ${b('--username=')}${u('username')}
  Use ${u('username')} instead of the username saved in ${b('~/.ph')}.

  ${b('-t')} ${u('timeout')}, ${b('--timeout=')}${u('timeout')}
  Set timeout to ${u('timeout')} seconds instead of default ${b(5)}.

Commands:
  ${usage.get}
  ${description.get}

  ${usage.put}
  ${description.put}

  ${usage.post}
  ${description.post}

  ${usage.delete}
  ${description.delete}

  ${usage.eventlog}
  ${description.eventlog}

  ${usage.discover}
  ${description.discover}

  ${usage.config}
  ${description.config}

  ${usage.description}
  ${description.description}

  ${usage.createuser}
  ${description.createuser}

  ${usage.unlock}
  ${description.unlock}

  ${usage.touchlink}
  ${description.touchlink}

  ${usage.search}
  ${description.search}

  ${usage.outlet}
  ${description.outlet}

  ${usage.switch}
  ${description.switch}

  ${usage.probe}
  ${description.probe}

  ${usage.restart}
  ${description.restart}

For more help, issue: ${b('ph')} ${u('command')} ${b('-h')}`,
  get: `${description.ph}

Usage: ${b('ph')} ${usage.get}

${description.get}

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-s')}          Sort object key/value pairs alphabetically on key.
  ${b('-n')}          Do not include spaces nor newlines in output.
  ${b('-j')}          Output JSON array of objects for each key/value pair.
              Each object contains two key/value pairs: key "keys" with an array
              of keys as value and key "value" with the value as value.
  ${b('-u')}          Output JSON array of objects for each key/value pair.
              Each object contains one key/value pair: the path (concatenated
              keys separated by '/') as key and the value as value.
  ${b('-a')}          Output path:value in plain text instead of JSON.
  ${b('-t')}          Limit output to top-level key/values.
  ${b('-l')}          Limit output to leaf (non-array, non-object) key/values.
  ${b('-k')}          Limit output to keys. With -u output JSON array of paths.
  ${b('-v')}          Limit output to values. With -u output JSON array of values.
  ${u('path')}        Path to retrieve from the Hue bridge.`,
  put: `${description.ph}

Usage: ${b('ph')} ${usage.put}

${description.put}

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-v')}          Verbose.
  ${u('resource')}    Resource to update.
  ${u('body')}        Body in JSON.`,
  post: `${description.ph}

Usage: ${b('ph')} ${usage.post}

${description.post}

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-v')}          Verbose.
  ${u('resource')}    Resource to update.
  ${u('body')}        Body in JSON.`,
  delete: `${description.ph}

Usage: ${b('ph')} ${usage.delete}

${description.delete}

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-v')}          Verbose.
  ${u('resource')}    Resource to update.
  ${u('body')}        Body in JSON.`,
  eventlog: `${description.ph}

Usage: ${b('ph')} ${usage.eventlog}

${description.eventlog}

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-n')}          Do not retry when connection is closed.
  ${b('-r')}          Do not parse events, output raw event data.
  ${b('-s')}          Do not output timestamps (useful when running as service).`,
  discover: `${description.ph}

Usage: ${b('ph')} ${usage.discover}

${description.discover}

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-S')}          Stealth mode, only use local discovery.`,
  config: `${description.ph}

Usage: ${b('ph')} ${usage.config}

${description.config}

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-s')}          Sort object key/value pairs alphabetically on key.`,
  description: `${description.ph}

Usage: ${b('ph')} ${usage.description}

${description.description}

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-s')}          Sort object key/value pairs alphabetically on key.`,
  createuser: `${description.ph}

Usage: ${b('ph')} ${usage.createuser}

${description.createuser}
You need to press the linkbutton on the Hue bridge prior to issuing this command.
The username is saved to ${b('~/.ph')}.

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-v')}          Verbose.`,
  unlock: `${description.ph}

Usage: ${b('ph')} ${usage.unlock}

${description.unlock}
This is the equivalent of pressing the linkbutton on the Hue bridge.

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-v')}          Verbose.`,
  touchlink: `${description.ph}

Usage: ${b('ph')} ${usage.touchlink}

${description.touchlink}

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-v')}          Verbose.`,
  search: `${description.ph}

Usage: ${b('ph')} ${usage.search}

${description.search}

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-v')}          Verbose.`,
  outlet: `${description.ph}

Usage: ${b('ph')} ${usage.outlet}

${description.outlet}
The outlet resourcelink indicates which lights (and groups) homebridge-hue
exposes as Outlet (instead of Lightbulb).

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-v')}          Verbose.`,
  switch: `${description.ph}

Usage: ${b('ph')} ${usage.switch}

${description.switch}
The switch resourcelink indicates which lights (and groups) homebridge-hue
exposes as Switch (instead of Lightbulb).

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-v')}          Verbose.`,
  probe: `${description.ph}

Usage: ${b('ph')} ${usage.probe}

${description.probe}

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-v')}          Verbose.
  ${b('-t')} ${u('timeout')}  Timeout after ${u('timeout')} minutes (default: 5).
  ${u('light')}       Light resource to probe.`,
  restart: `${description.ph}

Usage: ${b('ph')} ${usage.restart}

${description.restart}

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-v')}          Verbose.`
}

class Main extends CommandLineTool {
  constructor () {
    super({ mode: 'command', debug: false })
    this.usage = usage.ph
    try {
      this.readBridges()
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.error(error)
      }
      this.bridges = {}
    }
  }

  // ===========================================================================

  readBridges () {
    const text = fs.readFileSync(process.env.HOME + '/.ph')
    try {
      this.bridges = JSON.parse(text)
    } catch (error) {
      this.warn('%s/.ph: file corrupted', process.env.HOME)
      this.bridges = {}
    }
    // Convert old format
    let converted = false
    for (const bridgeid in this.bridges) {
      if (this.bridges[bridgeid].username == null) {
        converted = true
        this.bridges[bridgeid] = { username: this.bridges[bridgeid] }
      }
    }
    if (converted) {
      this.writeBridges()
    }
  }

  writeBridges () {
    const jsonFormatter = new JsonFormatter(
      { noWhiteSpace: true, sortKeys: true }
    )
    const text = jsonFormatter.stringify(this.bridges)
    fs.writeFileSync(process.env.HOME + '/.ph', text, { mode: 0o600 })
  }

  parseArguments () {
    const parser = new CommandLineParser(packageJson)
    const clargs = {
      options: {
        forceHttp: false,
        host: process.env.PH_HOST || 'localhost',
        timeout: 5
      }
    }
    parser
      .help('h', 'help', help.ph)
      .version('V', 'version')
      .option('H', 'host', (value) => {
        OptionParser.toHost('host', value, false, true)
        clargs.options.host = value
      })
      .flag('D', 'debug', () => {
        if (this.debugEnabled) {
          this.setOptions({ vdebug: true })
        } else {
          this.setOptions({ debug: true, chalk: true })
        }
      })
      .option('t', 'timeout', (value) => {
        clargs.options.timeout = OptionParser.toInt(
          'timeout', value, 1, 60, true
        )
      })
      .option('u', 'username', (value) => {
        clargs.options.username = OptionParser.toString(
          'username', value, true, true
        )
      })
      .parameter('command', (value) => {
        if (usage[value] == null || typeof this[value] !== 'function') {
          throw new UsageError(`${value}: unknown command`)
        }
        clargs.command = value
      })
      .remaining((list) => { clargs.args = list })
    parser
      .parse()
    return clargs
  }

  async main () {
    try {
      await this._main()
    } catch (error) {
      if (error.request == null) {
        this.error(error)
      }
    }
  }

  async _main () {
    const clargs = this.parseArguments()
    this.hueDiscovery = new HueDiscovery({
      forceHttp: clargs.options.forceHttp,
      timeout: clargs.options.timeout
    })
    this.hueDiscovery
      .on('error', (error) => {
        this.log(
          '%s: request %d: %s %s', error.request.name,
          error.request.id, error.request.method, error.request.resource
        )
        this.warn(
          '%s: request %d: %s', error.request.name, error.request.id, error
        )
      })
      .on('request', (request) => {
        this.debug(
          '%s: request %d: %s %s', request.name,
          request.id, request.method, request.resource
        )
        this.vdebug(
          '%s: request %d: %s %s', request.name,
          request.id, request.method, request.url
        )
      })
      .on('response', (response) => {
        this.vdebug(
          '%s: request %d: response: %j', response.request.name,
          response.request.id, response.body
        )
        this.debug(
          '%s: request %d: %d %s', response.request.name,
          response.request.id, response.statusCode, response.statusMessage
        )
      })
      .on('found', (name, id, address) => {
        this.debug('%s: found %s at %s', name, id, address)
      })
      .on('searching', (name, host) => {
        this.debug('%s: listening on %s', name, host)
      })
      .on('searchDone', (name) => { this.debug('%s: search done', name) })

    if (clargs.command === 'discover') {
      return this.discover(clargs.args)
    }
    try {
      this.bridgeConfig = await this.hueDiscovery.config(clargs.options.host)
    } catch (error) {
      if (error.request == null) {
        // this.error(error)
      }
      this.error('%s: not a Hue bridge', clargs.options.host)
      return
    }
    if (HueClient.isDeconzBridgeId(this.bridgeConfig.bridgeid)) {
      this.error('%s: deCONZ gateway no longer supported', clargs.options.host)
      return
    }
    if (clargs.command === 'config') {
      return this.config(clargs.args)
    }

    clargs.options.config = this.bridgeConfig
    this.bridgeid = this.bridgeConfig.bridgeid
    if (clargs.options.username == null) {
      if (
        this.bridges[this.bridgeid] != null &&
        this.bridges[this.bridgeid].username != null
      ) {
        clargs.options.username = this.bridges[this.bridgeid].username
      } else if (process.env.PH_USERNAME != null) {
        clargs.options.username = process.env.PH_USERNAME
      }
    }
    if (
      this.bridges[this.bridgeid] != null &&
      this.bridges[this.bridgeid].fingerprint != null
    ) {
      clargs.options.fingerprint = this.bridges[this.bridgeid].fingerprint
    }
    if (clargs.options.username == null && clargs.command !== 'createuser') {
      let args = ''
      if (
        clargs.options.host !== 'localhost' &&
        clargs.options.host !== process.env.PH_HOST
      ) {
        args += ' -H ' + clargs.options.host
      }
      await this.fatal(
        'missing username - press link button and run "ph%s createuser"', args
      )
    }
    this.hueClient = new HueClient(clargs.options)
    this.hueClient
      .on('error', (error) => {
        if (error.request.id !== this.requestId) {
          if (error.request.body == null) {
            this.log(
              'request %d: %s %s', error.request.id,
              error.request.method, error.request.resource
            )
          } else {
            this.log(
              'request %d: %s %s %s', error.request.id,
              error.request.method, error.request.resource, error.request.body
            )
          }
          this.requestId = error.request.id
        }
        if (error.nonCritical) {
          this.warn('request %d: %s', error.request.id, error)
        } else {
          this.error('request %d: %s', error.request.id, error)
        }
      })
      .on('request', (request) => {
        if (request.body == null) {
          this.debug(
            'request %d: %s %s', request.id, request.method, request.resource
          )
          this.vdebug(
            'request %d: %s %s', request.id, request.method, request.url
          )
        } else {
          this.debug(
            'request %d: %s %s %s', request.id,
            request.method, request.resource, request.body
          )
          this.vdebug(
            'request %d: %s %s %s', request.id,
            request.method, request.url, request.body
          )
        }
      })
      .on('response', (response) => {
        this.vdebug(
          'request %d: response: %j', response.request.id, response.body
        )
        this.debug(
          'request %d: %d %s', response.request.id,
          response.statusCode, response.statusMessage
        )
      })
    this.options = clargs.options
    this.name = 'ph ' + clargs.command
    this.usage = `${b('ph')} ${usage[clargs.command]}`
    return this[clargs.command](clargs.args)
  }

  // ===== GET =================================================================

  async get (...args) {
    const parser = new CommandLineParser(packageJson)
    const clargs = {
      options: {}
    }
    parser
      .help('h', 'help', help.get)
      .flag('s', 'sortKeys', () => { clargs.options.sortKeys = true })
      .flag('n', 'noWhiteSpace', () => {
        clargs.options.noWhiteSpace = true
      })
      .flag('j', 'jsonArray', () => { clargs.options.noWhiteSpace = true })
      .flag('u', 'joinKeys', () => { clargs.options.joinKeys = true })
      .flag('a', 'ascii', () => { clargs.options.ascii = true })
      .flag('t', 'topOnly', () => { clargs.options.topOnly = true })
      .flag('l', 'leavesOnly', () => { clargs.options.leavesOnly = true })
      .flag('k', 'keysOnly', () => { clargs.options.keysOnly = true })
      .flag('v', 'valuesOnly', () => { clargs.options.valuesOnly = true })
      .remaining((list) => {
        if (list.length > 1) {
          throw new UsageError('too many paramters')
        }
        clargs.resource = list.length === 0
          ? '/'
          : OptionParser.toPath('resource', list[0])
      })
      .parse(...args)
    const jsonFormatter = new JsonFormatter(clargs.options)
    const response = await this.hueClient.get(clargs.resource)
    this.print(jsonFormatter.stringify(response))
  }

  // ===== PUT, POST, DELETE ===================================================

  async resourceCommand (command, ...args) {
    const parser = new CommandLineParser(packageJson)
    const clargs = {
      options: {}
    }
    parser
      .help('h', 'help', help[command])
      .flag('v', 'verbose', () => { clargs.options.verbose = true })
      .parameter('resource', (resource) => {
        clargs.resource = OptionParser.toPath('resource', resource)
        if (clargs.resource === '/') {
          throw new UsageError(`/: invalid resource for ${command}`)
        }
      })
      .remaining((list) => {
        if (list.length > 1) {
          throw new Error('too many paramters')
        }
        if (list.length === 1) {
          try {
            clargs.body = JSON.parse(list[0])
          } catch (error) {
            throw new Error(error.message) // Covert TypeError to Error.
          }
        }
      })
      .parse(...args)
    const response = await this.hueClient[command](clargs.resource, clargs.body)
    const jsonFormatter = new JsonFormatter()
    if (clargs.options.verbose || response.success == null) {
      this.print(jsonFormatter.stringify(response.body))
      return
    }
    if (command !== 'put') {
      if (response.success.id != null) {
        this.print(jsonFormatter.stringify(response.success.id))
      } else {
        this.print(jsonFormatter.stringify(response.success))
      }
      return
    }
    this.print(jsonFormatter.stringify(response.success))
  }

  async put (...args) {
    return this.resourceCommand('put', ...args)
  }

  async post (...args) {
    return this.resourceCommand('post', ...args)
  }

  async delete (...args) {
    return this.resourceCommand('delete', ...args)
  }

  // ===========================================================================

  async destroy () {
    if (this.eventStream != null) {
      await this.eventStream.close()
    }
  }

  async eventlog (...args) {
    const parser = new CommandLineParser(packageJson)
    let mode = 'daemon'
    const options = {}
    parser
      .help('h', 'help', help.eventlog)
      .flag('n', 'noretry', () => { options.retryTime = 0 })
      .flag('r', 'raw', () => { options.raw = true })
      .flag('s', 'service', () => { mode = 'service' })
      .parse(...args)
    this.jsonFormatter = new JsonFormatter(
      mode === 'service' ? { noWhiteSpace: true } : {}
    )
    if (this.hueClient.isHue2) {
      const EventStreamClient = require('../lib/EventStreamClient')
      this.eventStream = new EventStreamClient(this.hueClient, options)
      this.setOptions({ mode })
      this.eventStream
        .on('error', (error) => {
          this.log(
            'request %d: %s %s', error.request.id,
            error.request.method, error.request.resource
          )
          this.warn('request %d: %s', error.request.id, error)
        })
        .on('request', (request) => {
          if (request.body == null) {
            this.debug(
              'request %d: %s %s', request.id, request.method, request.resource
            )
            this.vdebug(
              'request %d: %s %s', request.id, request.method, request.url
            )
          } else {
            this.debug(
              'request %d: %s %s %s', request.id,
              request.method, request.resource, request.body
            )
            this.vdebug(
              'request %d: %s %s %s', request.id,
              request.method, request.url, request.body
            )
          }
        })
        .on('response', (response) => {
          if (response.body != null) {
            this.vdebug(
              'request %d: response: %j', response.request.id, response.body
            )
          }
          this.debug(
            'request %d: %d %s', response.request.id,
            response.statusCode, response.statusMessage
          )
        })
        .on('listening', (url) => { this.log('listening on %s', url) })
        .on('closed', (url) => { this.log('connection to %s closed', url) })
        .on('changed', (resource, body) => {
          this.log('%s: %s', resource, this.jsonFormatter.stringify(body))
        })
        .on('notification', (body) => {
          if (options.raw) {
            this.log(this.jsonFormatter.stringify(body))
          } else {
            this.debug(this.jsonFormatter.stringify(body))
          }
        })
        .on('data', (s) => { this.vdebug('data: %s', s) })
      await this.eventStream.init()
      this.eventStream.listen()
    } else {
      await this.fatal('eventlog: only supported for Hue bridge with API v2')
    }
  }

  // ===========================================================================

  async simpleCommand (command, ...args) {
    const parser = new CommandLineParser(packageJson)
    const clargs = {
      options: {}
    }
    parser
      .help('h', 'help', help[command])
      .flag('v', 'verbose', () => { clargs.options.verbose = true })
      .parse(...args)
    const response = await this.hueClient[command]()
    const jsonFormatter = new JsonFormatter()
    for (const error of response.errors) {
      this.warn('api error %d: %s', error.type, error.description)
    }
    if (clargs.options.verbose || response.success == null) {
      this.print(jsonFormatter.stringify(response.body))
      return
    }
    if (response.success.id != null) {
      this.print(jsonFormatter.stringify(response.success.id))
      return
    }
    if (response.success != null) {
      this.print(jsonFormatter.stringify(response.success))
      return
    }
    this.print(jsonFormatter.stringify(response.body))
  }

  async discover (...args) {
    const parser = new CommandLineParser(packageJson)
    const params = { noDeconz: true }
    parser
      .help('h', 'help', help.discover)
      .flag('S', 'stealth', () => { params.stealth = true })
      .parse(...args)
    const jsonFormatter = new JsonFormatter({ sortKeys: true })
    const bridges = await this.hueDiscovery.discover(params)
    this.print(jsonFormatter.stringify(bridges))
  }

  async config (...args) {
    const parser = new CommandLineParser(packageJson)
    const options = {}
    parser
      .help('h', 'help', help.config)
      .flag('s', 'sortKeys', () => { options.sortKeys = true })
      .parse(...args)
    const jsonFormatter = new JsonFormatter(options)
    const json = jsonFormatter.stringify(this.bridgeConfig)
    this.print(json)
  }

  async description (...args) {
    const parser = new CommandLineParser(packageJson)
    const options = {}
    parser
      .help('h', 'help', help.description)
      .flag('s', 'sortKeys', () => { options.sortKeys = true })
      .parse(...args)
    const response = await this.hueDiscovery.description(this.options.host)
    const jsonFormatter = new JsonFormatter(options)
    const json = jsonFormatter.stringify(response)
    this.print(json)
  }

  async createuser (...args) {
    const parser = new CommandLineParser(packageJson)
    const jsonFormatter = new JsonFormatter(
      { noWhiteSpace: true, sortKeys: true }
    )
    parser
      .help('h', 'help', help.createuser)
      .parse(...args)
    const username = await this.hueClient.createuser('ph')
    this.print(jsonFormatter.stringify(username))
    this.bridges[this.bridgeid] = { username }
    if (this.hueClient.fingerprint != null) {
      this.bridges[this.bridgeid].fingerprint = this.hueClient.fingerprint
    }
    this.writeBridges()
  }

  async unlock (...args) {
    return this.simpleCommand('unlock', ...args)
  }

  async touchlink (...args) {
    return this.simpleCommand('touchlink', ...args)
  }

  async search (...args) {
    return this.simpleCommand('search', ...args)
  }

  // ===========================================================================

  async outlet (...args) {
    const parser = new CommandLineParser(packageJson)
    const clargs = {}
    parser
      .help('h', 'help', help.outlet)
      .flag('v', 'verbose', () => { clargs.verbose = true })
      .parse(...args)
    let outlet
    const lights = await this.hueClient.get('/lights')
    const resourcelinks = await this.hueClient.get('/resourcelinks')
    for (const id in resourcelinks) {
      const link = resourcelinks[id]
      if (link.name === 'homebridge-hue' && link.description === 'outlet') {
        outlet = id
      }
    }
    if (outlet == null) {
      const body = {
        name: 'homebridge-hue',
        classid: 1,
        description: 'outlet',
        links: []
      }
      const response = await this.hueClient.post('/resourcelinks', body)
      for (const error of response.errors) {
        this.warn('api error %d: %s', error.type, error.description)
      }
      outlet = response.success.id
    }
    const body = {
      links: []
    }
    for (const id in lights) {
      if (lights[id].type.includes('plug')) {
        body.links.push(`/lights/${id}`)
      }
    }
    await this.hueClient.put(`/resourcelinks/${outlet}`, body)
    clargs.verbose && this.log(
      '/resourcelinks/%s: %d outlets', outlet, body.links.length
    )
  }

  async switch (...args) {
    const parser = new CommandLineParser(packageJson)
    const clargs = {}
    parser
      .help('h', 'help', help.switch)
      .flag('v', 'verbose', () => { clargs.verbose = true })
      .parse(...args)
    let outlet
    const lights = await this.hueClient.get('/lights')
    const resourcelinks = await this.hueClient.get('/resourcelinks')
    for (const id in resourcelinks) {
      const link = resourcelinks[id]
      if (link.name === 'homebridge-hue' && link.description === 'switch') {
        outlet = id
      }
    }
    if (outlet == null) {
      const body = {
        name: 'homebridge-hue',
        classid: 1,
        description: 'switch',
        links: []
      }
      const response = await this.hueClient.post('/resourcelinks', body)
      for (const error of response.errors) {
        this.warn('api error %d: %s', error.type, error.description)
      }
      outlet = response.success.id
    }
    const body = {
      links: []
    }
    for (const id in lights) {
      if (lights[id].type.toLowerCase().includes('on/off')) {
        body.links.push(`/lights/${id}`)
      }
    }
    await this.hueClient.put(`/resourcelinks/${outlet}`, body)
    clargs.verbose && this.log(
      '/resourcelinks/%s: %d switches', outlet, body.links.length
    )
  }

  // ===== LIGHTVALUES =========================================================

  async probe (...args) {
    const parser = new CommandLineParser(packageJson)
    const clargs = {
      maxCount: 60
    }
    parser
      .help('h', 'help', help.probe)
      .flag('v', 'verbose', () => { clargs.verbose = true })
      .option('t', 'timeout', (value, key) => {
        OptionParser.toInt('timeout', value, 1, 10, true)
        clargs.maxCount = value * 12
      })
      .parameter('light', (value) => {
        if (value.substring(0, 8) !== '/lights/') {
          throw new UsageError(`${value}: invalid light`)
        }
        clargs.light = value
      })
      .parse(...args)
    const light = await this.hueClient.get(clargs.light)

    async function probeCt (name, value) {
      clargs.verbose && this.log(`${clargs.light}: ${name} ...\\c`)
      await this.hueClient.put(clargs.light + '/state', { ct: value })
      let count = 0
      return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
          const ct = await this.hueClient.get(clargs.light + '/state/ct')
          if (ct !== value || ++count > clargs.maxCount) {
            clearInterval(interval)
            clargs.verbose && this.logc(
              count > clargs.maxCount ? ' timeout' : ' done'
            )
            return resolve(ct)
          }
          clargs.verbose && this.logc('.\\c')
        }, 5000)
      })
    }

    async function probeXy (name, value) {
      clargs.verbose && this.log(`${clargs.light}: ${name} ...\\c`)
      await this.hueClient.put(clargs.light + '/state', { xy: value })
      let count = 0
      return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
          const xy = await this.hueClient.get(clargs.light + '/state/xy')
          if (
            xy[0] !== value[0] || xy[1] !== value[1] ||
            ++count > clargs.maxCount
          ) {
            clearInterval(interval)
            clargs.verbose && this.logc(
              count > clargs.maxCount ? ' timeout' : ' done'
            )
            return resolve(xy)
          }
          clargs.verbose && this.logc('.\\c')
        }, 5000)
      })
    }

    this.verbose && this.log(
      '%s: %s %s %s "%s"', clargs.light, light.manufacturername,
      light.modelid, light.type, light.name
    )
    const response = {
      manufacturername: light.manufacturername,
      modelid: light.modelid,
      type: light.type,
      bri: light.state.bri != null
    }
    await this.hueClient.put(clargs.light + '/state', { on: true })
    if (light.state.ct != null) {
      response.ct = {}
      response.ct.min = await probeCt.call(this, 'cool', 1)
      response.ct.max = await probeCt.call(this, 'warm', 1000)
    }
    if (light.state.xy != null) {
      const zero = 0.0001
      const one = 0.9961
      response.xy = {}
      response.xy.r = await probeXy.call(this, 'red', [one, zero])
      response.xy.g = await probeXy.call(this, 'green', [zero, one])
      response.xy.b = await probeXy.call(this, 'blue', [zero, zero])
    }
    await this.hueClient.put(clargs.light + '/state', { on: light.state.on })
    this.jsonFormatter = new JsonFormatter()
    const json = this.jsonFormatter.stringify(response)
    this.print(json)
  }

  // ===== BRIDGE/GATEWAY DISCOVERY ==============================================

  async restart (...args) {
    const parser = new CommandLineParser(packageJson)
    const clargs = {}
    parser
      .help('h', 'help', help.restart)
      .flag('v', 'verbose', () => { clargs.verbose = true })
      .parse(...args)
    if (this.hueClient.isHue) {
      const response = await this.hueClient.put('/config', { reboot: true })
      if (!response.success.reboot) {
        return false
      }
    } else {
      await this.fatal('restart: only supported for Hue bridge')
    }
    clargs.verbose && this.log('restarting ...\\c')
    return new Promise((resolve, reject) => {
      let busy = false
      const interval = setInterval(async () => {
        try {
          if (!busy) {
            busy = true
            const bridgeid = await this.hueClient.get('/config/bridgeid')
            if (bridgeid === this.bridgeid) {
              clearInterval(interval)
              clargs.verbose && this.logc(' done')
              return resolve(true)
            }
            busy = false
          }
        } catch (error) {
          busy = false
        }
        clargs.verbose && this.logc('.\\c')
      }, 2500)
    })
  }
}

new Main().main()

#!/usr/bin/env node

// homebridge-hue/cli/ph.js
//
// Homebridge plug-in for Philips Hue and/or deCONZ.
// Copyright © 2018-2020 Erik Baauw. All rights reserved.
//
// Command line interface to Philips Hue or deCONZ API.

'use strict'

const chalk = require('chalk')
const fs = require('fs')
const HueClient = require('../lib/HueClient')
const HueDiscovery = require('../lib/HueDiscovery')
const homebridgeLib = require('homebridge-lib')
const packageJson = require('../package.json')

const b = chalk.bold
const u = chalk.underline

class UsageError extends Error {}

const usage = {
  ph: `${b('ph')} [${b('-hVp')}] [${b('-H')} ${u('hostname')}[${b(':')}${u('port')}]] [${b('-u')} ${u('username')}] [${b('-t')} ${u('timeout')}] ${u('command')} [${u('argument')} ...]`,

  get: `${b('get')} [${b('-hsnjuatlkv')}] [${u('path')}]`,
  put: `${b('put')} [${b('-hv')}] ${u('resource')} [${u('body')}]`,
  post: `${b('post')} [${b('-hv')}] ${u('resource')} [${u('body')}]`,
  delete: `${b('delete')} [${b('-hv')}] ${u('resource')} [${u('body')}]`,

  discover: `${b('discover')} [${b('-hv')}] [${b('-t')} ${u('timeout')}]`,
  config: `${b('config')} [${b('-hs')}]`,
  description: `${b('description')} [${b('-hs')}]`,
  createuser: `${b('createuser')} [${b('-h')}]`,
  unlock: `${b('unlock')} [${b('-h')}]`,
  touchlink: `${b('touchlink')} [${b('-h')}]`,
  search: `${b('search')} [${b('-h')}]`,

  lightlist: `${b('lightlist')} [${b('-hv')}]`,
  outlet: `${b('outlet')} [${b('-hv')}]`,
  probe: `${b('probe')} [${b('-hv')}] [${b('-t')} ${u('timeout')}] ${u('light')}`,
  restart: `${b('restart')} [${b('-hv')}]`
}
const description = {
  ph: 'Command line interface to Philips Hue or deCONZ API.',

  get: `Retrieve ${u('path')} from bridge/gateway.`,
  put: `Update ${u('resource')} on bridge/gateway with ${u('body')}.`,
  post: `Create ${u('resource')} on bridge/gateway with ${u('body')}.`,
  delete: `Delete ${u('resource')} from bridge/gateway with ${u('body')}.`,

  discover: 'Discover bridges/gateways.',
  config: 'Retrieve bridge/gateway configuration (unauthenticated).',
  description: 'Retrieve bridge/gateway description.',
  createuser: 'Create bridge/gateway API username.',
  unlock: 'Unlock bridge/gateway so new API username can be created.',
  touchlink: 'Initiate a touchlink.',
  search: 'Initiate a seach for new devices.',

  lightlist: 'Create/update lightlist resourcelink.',
  outlet: 'Create/update outlet resourcelink.',
  probe: `Probe ${u('light')} for supported colour (temperature) range.`,
  restart: 'Restart Hue bridge or deCONZ gateway.'
}
const help = {
  ph: `${description.ph}

Usage: ${usage.ph}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-V')}, ${b('--version')}
  Print version and exit.

  ${b('-p')}, ${b('--phoscon')}
  Imitate the Phoscon app.  Only works for deCONZ.

  ${b('-H')} ${u('hostname')}[${b(':')}${u('port')}], ${b('--host=')}${u('hostname')}[${b(':')}${u('port')}]
  Connect to ${u('hostname')}${b(':80')} or ${u('hostname')}${b(':')}${u('port')} instead of the default ${b('localhost:80')}.

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

  ${usage.lightlist}
  ${description.lightlist}

  ${usage.outlet}
  ${description.outlet}

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
  ${u('path')}        Path to retrieve from the Hue bridge / deCONZ gateway.`,
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
  discover: `${description.ph}

Usage: ${b('ph')} ${usage.discover}

${description.discover}

Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-t')} ${u('timeout')}  Timeout UPnP search after ${u('timeout')} seconds (default: 5).
  ${b('-v')}          Verbose.`,
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
You need to press the linkbutton on the Hue bridge or unlock the deCONZ gateway
through the web app prior to issuing this command.
The username is saved to ${b('~/.ph')}.

Parameters:
  ${b('-h')}          Print this help and exit.`,
  unlock: `${description.ph}

Usage: ${b('ph')} ${usage.unlock}

${description.unlock}
This is the equivalent of pressing the linkbutton on the Hue bridge or unlocking
the deCONZ gateway through the web app.

Parameters:
  ${b('-h')}          Print this help and exit.`,
  touchlink: `${description.ph}

Usage: ${b('ph')} ${usage.touchlink}

${description.touchlink}

Parameters:
  ${b('-h')}          Print this help and exit.`,
  search: `${description.ph}

Usage: ${b('ph')} ${usage.search}

${description.search}

Parameters:
  ${b('-h')}          Print this help and exit.`,
  lightlist: `${description.ph}

Usage: ${b('ph')} ${usage.lightlist}

${description.lightlist}
To prevent HomeKit from losing lights that are not yet available on a deCONZ
gateway, homebridge-hue will delay starting the homebridge server, until all
resources in the lightlist resourcelink are available.

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

class Main extends homebridgeLib.CommandLineTool {
  constructor () {
    super({ mode: 'command', debug: false })
    this.usage = usage.ph
    try {
      this._readBridges()
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.error(err)
      }
      this.bridges = {}
    }
  }

  // ===========================================================================

  _readBridges () {
    const text = fs.readFileSync(process.env.HOME + '/.ph')
    this.bridges = JSON.parse(text)
    // Convert old format
    let converted = false
    for (const bridgeid in this.bridges) {
      if (this.bridges[bridgeid].username == null) {
        converted = true
        this.bridges[bridgeid] = { username: this.bridges[bridgeid] }
      }
    }
    if (converted) {
      this._writeBridges()
    }
  }

  _writeBridges () {
    const jsonFormatter = new homebridgeLib.JsonFormatter(
      { noWhiteSpace: true, sortKeys: true }
    )
    const text = jsonFormatter.stringify(this.bridges)
    fs.writeFileSync(process.env.HOME + '/.ph', text, { mode: 0o600 })
  }

  parseArguments () {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const clargs = {
      options: {
        host: process.env.PH_HOST || 'localhost'
      }
    }
    parser.help('h', 'help', help.ph)
    parser.version('V', 'version')
    parser.option('H', 'host', (value) => {
      homebridgeLib.OptionParser.toHost('host', value, true)
      clargs.options.host = value
    })
    parser.flag('p', 'phoscon', () => {
      clargs.options.phoscon = true
    })
    parser.flag('s', 'https', () => {
      clargs.options.https = true
    })
    parser.option('t', 'timeout', (value) => {
      clargs.options.timeout = homebridgeLib.OptionParser.toInt(
        'timeout', value, 1, 60, true
      )
    })
    parser.option('u', 'username', (value) => {
      clargs.options.username = homebridgeLib.OptionParser.toString(
        'username', value, true, true
      )
    })
    parser.parameter('command', (value) => {
      if (usage[value] == null || typeof this[value] !== 'function') {
        throw new UsageError(`${value}: unknown command`)
      }
      clargs.command = value
    })
    parser.remaining((list) => { clargs.args = list })
    parser.parse()
    return clargs
  }

  async main () {
    try {
      const clargs = this.parseArguments()
      this.hueClient = new HueClient(clargs.options)
      if (clargs.command !== 'discover') {
        try {
          await this.hueClient.connect()
          this.bridgeid = this.hueClient.bridgeid
        } catch (error) {
          this.error('%s: %s', clargs.options.host, error.message)
          this.fatal('%s: not a Hue bridge nor deCONZ gateway', clargs.options.host)
        }
        if (clargs.command !== 'config' && clargs.command !== 'description') {
          clargs.options.bridgeid = this.bridgeid
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
            this.fatal(
              'missing username - %s and run "ph%s createuser"',
              this.hueClient.isDeconz ? 'unlock gateway' : 'press link button', args
            )
          }
          this.hueClient = new HueClient(clargs.options)
          await this.hueClient.connect()
        }
      }
      this.name = 'ph ' + clargs.command
      this.usage = `${b('ph')} ${usage[clargs.command]}`
      await this[clargs.command](clargs.args)
    } catch (err) {
      this.fatal(err)
    }
  }

  // ===== GET =================================================================

  async get (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const clargs = {
      options: {}
    }
    parser.help('h', 'help', help.get)
    parser.flag('s', 'sortKeys', () => { clargs.options.sortKeys = true })
    parser.flag('n', 'noWhiteSpace', () => {
      clargs.options.noWhiteSpace = true
    })
    parser.flag('j', 'jsonArray', () => { clargs.options.noWhiteSpace = true })
    parser.flag('u', 'joinKeys', () => { clargs.options.joinKeys = true })
    parser.flag('a', 'ascii', () => { clargs.options.ascii = true })
    parser.flag('t', 'topOnly', () => { clargs.options.topOnly = true })
    parser.flag('l', 'leavesOnly', () => { clargs.options.leavesOnly = true })
    parser.flag('k', 'keysOnly', () => { clargs.options.keysOnly = true })
    parser.flag('v', 'valuesOnly', () => { clargs.options.valuesOnly = true })
    parser.remaining((list) => {
      if (list.length > 1) {
        throw new UsageError('too many paramters')
      }
      clargs.resource = list.length === 1 ? list[0] : '/'
      if (clargs.resource[0] !== '/') {
        throw new UsageError(`${clargs.resource}: invalid resource`)
      }
    })
    parser.parse(...args)
    const jsonFormatter = new homebridgeLib.JsonFormatter(clargs.options)
    const response = await this.hueClient.get(clargs.resource)
    const json = jsonFormatter.stringify(response)
    this.print(json)
  }

  // ===== PUT, POST, DELETE ===================================================

  async resourceCommand (command, ...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const clargs = {
      options: {}
    }
    parser.help('h', 'help', help[command])
    parser.flag('v', 'verbose', () => { clargs.options.verbose = true })
    parser.parameter('resource', (value) => {
      clargs.resource = value
      if (
        clargs.resource.length === 0 || clargs.resource[0] !== '/' ||
        clargs.resource === '/'
      ) {
        throw new Error(`${clargs.resource}: invalid resource`)
      }
    })
    parser.remaining((list) => {
      if (list.length > 1) {
        throw new Error('too many paramters')
      }
      if (list.length === 1) {
        try {
          clargs.body = JSON.parse(list[0])
        } catch (err) {
          throw new Error(err.message)
        }
      }
    })
    parser.parse(...args)
    const response = await this.hueClient[command](clargs.resource, clargs.body)
    if (response != null) {
      const jsonFormatter = new homebridgeLib.JsonFormatter()
      if (clargs.options.verbose) {
        const json = jsonFormatter.stringify(response)
        this.print(json)
      } else if (command === 'post') {
        const key = Object.keys(response)[0]
        const json = jsonFormatter.stringify(response[key])
        this.print(json)
      }
    }
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

  async simpleCommand (command, ...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    parser.help('h', 'help', help[command])
    parser.parse(...args)
    const response = await this.hueClient[command]()
    const jsonFormatter = new homebridgeLib.JsonFormatter()
    const json = jsonFormatter.stringify(response)
    this.print(json)
  }

  async discover (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const clargs = {}
    parser.help('h', 'help', help.discover)
    parser.option('t', 'timeout', (value, key) => {
      clargs.timeout = homebridgeLib.OptionParser.toInt(
        'timeout', value, 1, 60, true
      )
    })
    parser.flag('v', 'verbose', () => { clargs.verbose = true })
    parser.parse(...args)
    const hueDiscovery = new HueDiscovery(clargs)
    const jsonFormatter = new homebridgeLib.JsonFormatter({ sortKeys: true })
    const bridges = await hueDiscovery.discover()
    this.print(jsonFormatter.stringify(bridges))
  }

  async config (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const options = {}
    parser.help('h', 'help', help.config)
    parser.flag('s', 'sortKeys', () => { options.sortKeys = true })
    parser.parse(...args)
    const jsonFormatter = new homebridgeLib.JsonFormatter(options)
    const json = jsonFormatter.stringify(await this.hueClient.config())
    this.print(json)
  }

  async description (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const options = {}
    parser.help('h', 'help', help.description)
    parser.flag('s', 'sortKeys', () => { options.sortKeys = true })
    parser.parse(...args)
    const response = await this.hueClient.description()
    const jsonFormatter = new homebridgeLib.JsonFormatter(options)
    const json = jsonFormatter.stringify(response)
    this.print(json)
  }

  async createuser (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const jsonFormatter = new homebridgeLib.JsonFormatter(
      { noWhiteSpace: true, sortKeys: true }
    )
    parser.help('h', 'help', help.createuser)
    parser.parse(...args)
    const username = await this.hueClient.createuser('ph')
    this.print(jsonFormatter.stringify(username))
    this.bridges[this.bridgeid] = { username: username }
    if (this.hueClient.fingerprint != null) {
      this.bridges[this.bridgeid].fingerprint = this.hueClient.fingerprint
    }
    this._writeBridges()
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

  async lightlist (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const clargs = {}
    parser.help('h', 'help', help.lightlist)
    parser.flag('v', 'verbose', () => { clargs.verbose = true })
    parser.parse(...args)
    let lightlist
    const lights = await this.hueClient.get('/lights')
    const resourcelinks = await this.hueClient.get('/resourcelinks')
    for (const id in resourcelinks) {
      const link = resourcelinks[id]
      if (link.name === 'homebridge-hue' && link.description === 'lightlist') {
        lightlist = id
      }
    }
    if (lightlist == null) {
      const body = {
        name: 'homebridge-hue',
        classid: 1,
        description: 'lightlist',
        links: []
      }
      const response = await this.hueClient.post('/resourcelinks', body)
      const key = Object.keys(response)[0]
      lightlist = response[key]
    }
    const body = {
      links: []
    }
    for (const id in lights) {
      body.links.push(`/lights/${id}`)
    }
    await this.hueClient.put(`/resourcelinks/${lightlist}`, body)
    clargs.verbose && this.log(
      '/resourcelinks/%s: %d lights', lightlist, body.links.length
    )
  }

  async outlet (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const clargs = {}
    parser.help('h', 'help', help.outlet)
    parser.flag('v', 'verbose', () => { clargs.verbose = true })
    parser.parse(...args)
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
      const key = Object.keys(response)[0]
      outlet = response[key]
    }
    const body = {
      links: []
    }
    for (const id in lights) {
      if (lights[id].type.substr(-5) !== 'light') {
        body.links.push(`/lights/${id}`)
      }
    }
    await this.hueClient.put(`/resourcelinks/${outlet}`, body)
    clargs.verbose && this.log(
      '/resourcelinks/%s: %d outlets', outlet, body.links.length
    )
  }

  // ===== LIGHTVALUES =========================================================

  async probe (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const clargs = {
      maxCount: 60
    }
    parser.help('h', 'help', help.probe)
    parser.flag('v', 'verbose', () => { clargs.verbose = true })
    parser.option('t', 'timeout', (value, key) => {
      homebridgeLib.OptionParser.toInt(
        'timeout', value, 1, 10, true
      )
      clargs.maxCount = value * 12
    })
    parser.parameter('light', (value) => {
      if (value.substring(0, 8) !== '/lights/') {
        throw new UsageError(`${value}: invalid light`)
      }
      clargs.light = value
    })
    parser.parse(...args)
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

    function round (f) {
      return Math.round(f * 10000) / 10000
    }

    async function probeXy (name, value) {
      clargs.verbose && this.log(`${clargs.light}: ${name} ...\\c`)
      await this.hueClient.put(clargs.light + '/state', { xy: value })
      let count = 0
      return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
          let xy = await this.hueClient.get(clargs.light + '/state/xy')
          if (this.hueClient.isDeconz) {
            xy = [round(xy[0]), round(xy[1])]
          }
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
    this.jsonFormatter = new homebridgeLib.JsonFormatter()
    const json = this.jsonFormatter.stringify(response)
    this.print(json)
  }

  // ===== BRIDGE/GATEWAY DISCOVERY ==============================================

  async restart (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const clargs = {}
    parser.help('h', 'help', help.restart)
    parser.flag('v', 'verbose', () => { clargs.verbose = true })
    parser.parse(...args)
    if (this.hueClient.isHue) {
      const response = await this.hueClient.put('/config', { reboot: true })
      if (!response.reboot) {
        return false
      }
    } else if (this.hueClient.isDeconz) {
      const response = await this.hueClient.post('/config/restartapp')
      if (!response['/config/restartapp']) {
        return false
      }
    } else {
      this.fatal('restart: only supported for Hue bridge or deCONZ gateway')
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
        } catch (err) {
          busy = false
        }
        clargs.verbose && this.logc('.\\c')
      }, 2500)
    })
  }
}

new Main().main()

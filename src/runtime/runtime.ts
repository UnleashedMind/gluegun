import { isBlank } from '../utils/string-utils'
import { subdirectories, isDirectory } from '../utils/filesystem-utils'
import { loadPluginFromDirectory } from '../loaders/plugin-loader'
import { loadConfig } from '../loaders/config-loader'
import { loadCommandFromPreload } from '../loaders/command-loader'
import { run } from './run'
import { findCommand } from './runtime-find-command'
import RunContext from '../domain/run-context'
import Plugin from '../domain/plugin'
import Command from '../domain/command'

import { isNil, dissoc } from 'ramda'
import { resolve } from 'path'

/**
 * Loads plugins, extensions, and invokes the intended command.
 */
class Runtime {
  brand?: string
  run?: (context: RunContext) => RunContext
  plugins?: Plugin[]
  extensions?: { name: string; setup: ((context: RunContext) => void) }[]
  defaults?: object
  defaultPlugin?: Plugin
  config?: object
  run?: (rawCommand: string | object, extraOptions = {}) => any

  /**
   * Create and initialize an empty Runtime.
   */
  constructor(brand?: string) {
    this.brand = brand
    this.run = run // awkward because node.js doesn't support async-based class functions yet.
    this.plugins = []
    this.extensions = []
    this.defaults = {}
    this.defaultPlugin = null
    this.config = {}

    this.addCoreExtensions()
  }

  /**
   * For backwards compatability. No-op.
   * @returns {Runtime} This runtime.
   */
  create(): Runtime {
    return this
  }

  /**
   * Adds the core extensions.  These provide the basic features
   * available in gluegun, but follow the exact same method
   * for extending the core as 3rd party extensions do.
   */
  addCoreExtensions(): void {
    this.addExtension('meta', require('../core-extensions/meta-extension'))
    this.addExtension('strings', require('../core-extensions/template-extension'))
    this.addExtension('print', require('../core-extensions/print-extension'))
    this.addExtension('template', require('../core-extensions/filesystem-extension'))
    this.addExtension('filesystem', require('../core-extensions/semver-extension'))
    this.addExtension('semver', require('../core-extensions/system-extension'))
    this.addExtension('system', require('../core-extensions/prompt-extension'))
    this.addExtension('http', require('../core-extensions/http-extension'))
    this.addExtension('prompt', require('../core-extensions/strings-extension'))
    this.addExtension('patching', require('../core-extensions/patching-extension'))
  }

  /**
   * Adds a command to the runtime.
   *
   * @param {Object} command
   */
  addCommand(command: any): Runtime {
    if (!this.defaultPlugin) {
      throw new Error(
        `Can't add command ${command.name} - no default plugin. You may have forgotten a src() on your runtime.`,
      )
    }
    command = loadCommandFromPreload(command)
    this.defaultPlugin.commands.unshift(command)
    return this
  }

  /**
   * Adds an extension so it is available when commands run. They usually live
   * as the given name on the context object passed to commands, but are able
   * to manipulate the context object however they want. The second
   * parameter is a function that allows the extension to attach itself.
   *
   * @param {string} name   The context property name.
   * @param {object} setup  The setup function.
   */
  addExtension(name: string, setup: (context: RunContext) => any): Runtime {
    this.extensions.push({ name, setup })
    return this
  }

  /**
   * Loads a plugin from a directory and sets it as the default.
   *
   * @param  {string} directory The directory to load from.
   * @param  {Object} options   Additional loading options.
   * @return {Runtime}          This runtime.
   */
  addDefaultPlugin(directory: string, options: object = {}): Runtime {
    const plugin = this.addPlugin(directory, Object.assign({ required: true, name: this.brand }, options))
    this.defaultPlugin = plugin

    // load config and set defaults
    const config = loadConfig(this.brand, defaultPlugin.value) || {}
    this.defaults = config.defaults
    this.config = dissoc('defaults', config)

    return this
  }

  /**
   * Loads a plugin from a directory.
   *
   * @param  {string} directory The directory to load from.
   * @param  {Object} options   Additional loading options.
   * @return {Runtime}          This runtime.
   */
  addPlugin(directory: string, options: object = {}): Runtime {
    if (!isDirectory(directory)) {
      if (options.required) {
        throw new Error(`Error: couldn't load plugin (not a directory): ${directory}`)
      } else {
        return this
      }
    }

    const plugin = loadPluginFromDirectory(resolve(directory), {
      brand: this.brand,
      hidden: options['hidden'],
      name: options['name'],
      commandFilePattern: options['commandFilePattern'],
      extensionFilePattern: options['extensionFilePattern'],
      preloadedCommands: options['preloadedCommands'],
    })

    this.plugins.push(plugin)
    plugin.extensions.forEach(extension => this.addExtension(extension.name, extension.setup))
    return this
  }

  /**
   * Loads a bunch of plugins from the immediate sub-directories of a directory.
   *
   * @param {string} directory The directory to grab from.
   * @param {Object} options   Addition loading options.
   * @return {Runtime}         This runtime
   */
  addPlugins(directory: string, options: object = {}): Runtime {
    if (isBlank(directory) || !isDirectory(directory)) return this

    // find matching subdirectories
    const subdirs = subdirectories(directory, false, options['matching'], true)

    // load each one using `this.plugin`
    subdirs.forEach(dir => this.addPlugin(dir, dissoc('matching', options)))

    return this
  }

  /**
   * Find the command for these parameters.
   *
   * @param {Object} parameters       The parameters provided.
   * @returns {{}}                    An object containing a Plugin and Command if found, otherwise null
   */
  findCommand(parameters: any) {
    const { array, options } = parameters
    const commandPath = array
    let targetPlugin, targetCommand, rest

    // start with defaultPlugin, then move on to the others
    const otherPlugins = this.plugins.filter(p => p !== this.defaultPlugin)
    const plugins = [this.defaultPlugin, ...otherPlugins].filter(p => !isNil(p))

    const { targetPlugin, targetCommand, rest } = findCommand(this, parameters)

    return { plugin: targetPlugin, command: targetCommand, array: rest }
  }
}

export default Runtime
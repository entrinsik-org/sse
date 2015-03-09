'use strict';

var redis = require('redis');
var hoek = require('hoek');
var internals = {};
var _ = require('lodash');
var q = require('q');
var util = require('util');

internals.defaults = {
    host: '127.0.0.1',
    port: 6379
};

/**
 * Creates a new subscribers redis key for a room
 * @param {String} room the room id
 * @return {String}
 */
function subscribersKey(room) {
    return util.format('room:%s:channels', room);
}

/**
 * Creates a new redis client out of the specified redis settings
 * @param { {host: String=, port: Number=, password: String=} =} settings redis settings
 * @return {*}
 */
function createClient(settings) {
    var client = redis.createClient(settings.port, settings.host);

    if (settings.password) {
        client.auth(settings.password);
    }

    return client;
}

/**
 * A channel manager manages individual and group/room subscriptions to publish and receive messages
 * @param { {host: String=, port: Number=, password: String=} =} redisSettings settings to use to connect to the redis server
 * @constructor
 */
function ChannelManager(redisSettings) {
    var settings = hoek.applyToDefaults(internals.defaults, redisSettings || {});
    var self = this;

    this.subscribers = {};
    this.nextId = 0;

    // redis requires dedicated connection for subscriptions
    this.subConn = createClient(settings);
    this.pubConn = createClient(settings);

    this.subConn.on('message', function (channel, message) {
        // check for listeners
        if (self.subscribers[channel]) {
            _.forEach(self.subscribers[channel], function(subscriber) {
                subscriber(message);
            });
        }
    });
}

/**
 * Subcribes a callback function to a channel id. Returns an unsubscribe() function that may be invoked to unsubscribe
 * the listener.
 * @param {String} channel the channel id
 * @param {Function} fn the callback function to be called with the message
 * @return {function(this:ChannelManager)} an unsubscribe function
 */
ChannelManager.prototype.subscribe = function(channel, fn) {
    var subs = this.subscribers[channel];

    // havent subscribed to this channel yet. create a new subscribers object and register ourselves with redis
    if (!subs) {
        subs = {};
        this.subscribers[channel] = subs;
        this.subConn.subscribe(channel);
    }

    var id = this.nextId++;
    subs[id] = fn;
    return this.unsubscribe.bind(this, channel, id);
};

/**
 * Unsubscribes a listener from a specified channel. Called via the unsubscribe function
 * @param {String} channel the channel Id
 * @param {Number} listenerId the listener id
 */
ChannelManager.prototype.unsubscribe = function (channel, listenerId) {
    if (this.subscribers[channel]) {
        var subs = this.subscribers[channel];

        // remove the user / channel from the room
        delete(subs[listenerId]);

        // also delete the subscribers entry and redis subscription if this was the last member
        if (_.keys(subs).length === 0) {
            delete(this.subscribers[channel]);
            this.subConn.unsubscribe(channel);
        }
    }
};

/**
 * Publishes a message to a specific channel, or user
 * @param {String} channel the channel id
 * @param {String} message the message to send
 * @return {*}
 */
ChannelManager.prototype.publish = function(channel, message) {
    return q.ninvoke(this.pubConn, 'publish', channel, message);
};

/**
 * Associates a channel with a room to receive broadcast messages for that room
 * @param {String} room the room id
 * @param {String} channel the channel id
 * @return {Promise} resolved once the enter function completes
 */
ChannelManager.prototype.enter = function(room, channel) {
    return q.ninvoke(this.pubConn, 'sadd', subscribersKey(room), channel);
};

/**
 * Dissocisates a channel from a room id
 * @param {String} room the room id
 * @param {String} channel the channel id
 * @return {Promise} resolved once the leave function completes
 */
ChannelManager.prototype.leave = function(room, channel) {
    return q.ninvoke(this.pubConn, 'srem', subscribersKey(room), channel);
};

/**
 * Returns a promise for the members of a specific room
 * @param {String} room the room id
 * @return {Promise} resolved once the members function completes
 */
ChannelManager.prototype.members = function (room) {
    return q.ninvoke(this.pubConn, 'smembers', subscribersKey(room));
};

/**
 * Closes a room, removing all members
 * @param {String} room the room id
 * @return {Promise} resolved once the method completes
 */
ChannelManager.prototype.close = function (room) {
    return q.ninvoke(this.pubConn, 'del', subscribersKey(room));
};

/**
 * Broadcasts a message to all members of a room
 * @param {String} room the room id
 * @param {String} message the message to send
 * @return {Promise} resolved one the broadcast completes
 */
ChannelManager.prototype.broadcast = function(room, message) {
    var self = this;
    return this.members(room).then(function (subscribers) {
        return q.all(subscribers.map(function (channel) {
            return self.publish(channel, message);
        }));
    });
};

/**
 *
 * @type {ChannelManager}
 */
module.exports.ChannelManager = ChannelManager;
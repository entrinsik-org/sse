'use strict';

var stream = require('stream');
var url = require('url');
var hoek = require('hoek');
var Channels = require('./channel-manager').ChannelManager;

// Declare internals

var internals = {};


// Defaults

internals.defaults = {
    userMethod: function(request) {
        return request.auth.credentials.obj;
    },
    apiUrl: '/api',
    apiServerLabel: null,
    redis: {}
};

module.exports.register = function(server, opts, next) {
    var settings = hoek.applyToDefaults(internals.defaults, opts);
    var channels = new Channels(opts.redis);

    var selection = settings.apiServerLabel ? server.select(settings.apiServerLabel) : server;

    // for changing the algorithm of getting the user id for the request
    selection.expose('setUserMethod', function (userMethod) {
        settings.userMethod = userMethod;
    });

    /**
     * Creates an SSE connection to receive all events broadcast to the user's channel, directly or indirectly.
     * Because the browser controls the EventSource http connection, credentials must be passed expressly through
     * the URL rather than via the request header.
     */
    selection.route({
        path: url.resolve(settings.apiUrl, 'events'),
        method: 'GET',
        config: {
            app: {
                hal: {
                    apiRel: 'inf:events',
                    query: '{?token}'
                }
            },
            handler: function (request, reply) {
                var userId = settings.userMethod(request);
                var id = 0;
                var channel = new stream.PassThrough();
                var response = reply(channel);
                var unsubscribe = channels.subscribe(userId, function (message) {
                    channel.write('id: ' + id++ + '\n');
                    channel.write('data: ' + message + '\n\n');
                });
                response.code(200)
                    .type('text/event-stream')
                    .header('Connection', 'keep-alive')
                    .header('Cache-Control', 'no-cache')
                    .header('Content-Encoding', 'identity');

                request.once('disconnect', unsubscribe);
            }
        }
    });

    /**
     * Subscribes the user to events pertaining to a specific 'room'. Events broadcast to the room will begin to flow
     * out the user's sse channel
     */
    selection.route({
        path: url.resolve(settings.apiUrl, 'events/{room}'),
        method: 'PUT',
        config: {
            handler: function (request, reply) {
                var userId = settings.userMethod(request);
                channels.enter(request.params.room, userId);
                reply();
            }
        }
    });

    /**
     * Unsubscribes the user from a room
     */
    selection.route({
        path: url.resolve(settings.apiUrl, 'events/{room}'),
        method: 'DELETE',
        config: {
            handler: function (request, reply) {
                var userId = settings.userMethod(request);
                channels.leave(request.params.room, userId);
                reply();
            }
        }
    });

    /**
     * Posts a new message to a room
     */
    selection.route({
        path: url.resolve(settings.apiUrl, 'events/{room}'),
        method: 'POST',
        config: {
            handler: function (request, reply) {
                channels.broadcast(request.params.room, JSON.stringify(request.payload));
                reply();
            }
        }
    });

    server.expose('publish', channels.publish.bind(channels));
    server.expose('enter', channels.enter.bind(channels));
    server.expose('leave', channels.leave.bind(channels));
    server.expose('members', channels.members.bind(channels));
    server.expose('close', channels.close.bind(channels));
    server.expose('broadcast', channels.broadcast.bind(channels));
    next();
};

exports.register.attributes = {
    pkg: require('../package.json')
};
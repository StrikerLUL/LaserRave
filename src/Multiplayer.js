import Peer from 'peerjs';

export class Multiplayer {
    constructor(isHost, roomId = null) {
        this.isHost = isHost;
        this.roomId = roomId;
        this.peer = null;
        this.connections = []; 
        this.connection = null; 
        
        this.onConnectedAsHost = null;
        this.onConnectedAsClient = null;
        this.onReceiveAudio = null;
        this.onReceiveState = null;
        this.onReceivePlaybackUpdate = null;
        this.onReceiveEvent = null; 
        
        this.audioBufferCache = null; 
    }

    init() {
        return new Promise((resolve, reject) => {
            if (this.isHost) {
                const id = 'rave-' + Math.random().toString(36).substring(2, 9);
                this.peer = new Peer(id);
                this.peer.on('open', (id) => {
                    this.roomId = id;
                    if (this.onConnectedAsHost) this.onConnectedAsHost(id);
                    resolve(id);
                });

                this.peer.on('connection', (conn) => {
                    this.connections.push(conn);
                    conn.on('data', (data) => this.handleHostData(data, conn));
                    conn.on('open', () => {
                        console.log('Client connected:', conn.peer);
                        if (this.audioBufferCache) {
                            this.sendAudioToConnection(conn, this.audioBufferCache);
                        }
                    });
                    conn.on('close', () => {
                        this.connections = this.connections.filter(c => c !== conn);
                    });
                });
                this.peer.on('error', (err) => reject(err));
            } else {
                this.peer = new Peer();
                this.peer.on('open', (id) => {
                    this.connection = this.peer.connect(this.roomId, { reliable: true });
                    this.connection.on('open', () => {
                        console.log('Connected to host!');
                        if (this.onConnectedAsClient) this.onConnectedAsClient();
                        resolve(id);
                    });
                    this.connection.on('data', (data) => this.handleClientData(data));
                    this.connection.on('error', (err) => {
                        console.error("Connection error:", err);
                        reject(err);
                    });
                });
                this.peer.on('error', (err) => reject(err));
            }
        });
    }

    setAudioBuffer(arrayBuffer, fileName) {
        if (!this.isHost) return;
        this.audioBufferCache = { buffer: arrayBuffer, name: fileName };
        this.connections.forEach(conn => {
            this.sendAudioToConnection(conn, this.audioBufferCache);
        });
    }

    sendAudioToConnection(conn, cache) {
        console.log('Sending audio to', conn.peer);
        // PeerJS handles ArrayBuffer serialization
        conn.send({
            type: 'audio',
            buffer: cache.buffer,
            name: cache.name
        });
    }

    broadcastState(cfg) {
        if (!this.isHost) return;
        const msg = { type: 'state', cfg: cfg };
        this.connections.forEach(conn => conn.send(msg));
    }

    broadcastPlayback(time, isPlaying) {
        if (!this.isHost) return;
        const msg = { type: 'playback', time: time, isPlaying: isPlaying };
        this.connections.forEach(conn => conn.send(msg));
    }

    broadcastEvent(eventName, data) {
        if (!this.isHost) return;
        const msg = { type: 'event', eventName, data };
        this.connections.forEach(conn => conn.send(msg));
    }

    handleHostData(data, conn) {
        // Can be used for chat or client interactions
    }

    handleClientData(data) {
        if (data.type === 'audio') {
            console.log("Received audio from host!");
            const blob = new Blob([data.buffer]);
            const file = new File([blob], data.name || 'received.mp3', { type: 'audio/mpeg' });
            if (this.onReceiveAudio) this.onReceiveAudio(file);
        } else if (data.type === 'state') {
            if (this.onReceiveState) this.onReceiveState(data.cfg);
        } else if (data.type === 'playback') {
            if (this.onReceivePlaybackUpdate) this.onReceivePlaybackUpdate(data.time, data.isPlaying);
        } else if (data.type === 'event') {
            if (this.onReceiveEvent) this.onReceiveEvent(data.eventName, data.data);
        }
    }
}

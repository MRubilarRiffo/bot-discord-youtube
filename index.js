const Config = require("./Config.json");
const pkg = require("./package.json");
const { Client, GatewayIntentBits } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioResource,
    createAudioPlayer,
    NoSubscriberBehavior,
    StreamType,
    AudioPlayerStatus
} = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');

const TOKEN = Config.TOKEN;
const PREFIX = Config.PREFIX;

// Usaremos un Map para almacenar las suscripciones de música por servidor.
// Clave = guildId, Valor = { connection, audioPlayer, queue: [...], ytdlProcess: ChildProcess | null }
const subscriptions = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

client.on('ready', () => {
    console.log("Serenade v" + pkg.version);
    console.log("Conectado como", client.user.tag);
});

/**
 * Función auxiliar que reproduce la siguiente pista en la cola para una suscripción dada.
 * Si la cola está vacía, se desconecta automáticamente.
 */
function playNext(guildId) {
    const subscription = subscriptions.get(guildId);
    if(!subscription) return;

    // Si no hay nada en la cola, desconectar y eliminar la suscripción.
    if(subscription.queue.length === 0) {
        subscription.connection.destroy();
        subscriptions.delete(guildId);
        return;
    }

    // De lo contrario, desencolar la siguiente URL y transmitirla.
    const nextUrl = subscription.queue.shift();

    // Crear el proceso ytdl
    const ytdlProcess = youtubedl.exec(nextUrl, {
        format: 'bestaudio',
        noPlaylist: true,
        output: '-'
    });

    // Registro opcional
    ytdlProcess.on('close', (code, signal) => {
        console.log(`Proceso ytdl cerrado. código=${code}, señal=${signal}`);
    });

    // Almacenar el proceso ytdl actual en la suscripción
    subscription.ytdlProcess = ytdlProcess;

    // Crear un recurso de audio
    const resource = createAudioResource(ytdlProcess.stdout, {
        inputType: StreamType.Arbitrary
    });

    subscription.audioPlayer.play(resource);
    console.log("Ahora transmitiendo:", nextUrl);
}

/**
 * Al recibir el mensaje, analizar el prefijo y el comando.
 */
client.on('messageCreate', async (message) => {
    if(!message.guild || message.author.bot) return;
    if(!message.content.startsWith(PREFIX)) return;

    const [command, ...args] = message.content.slice(PREFIX.length).split(' ');

    // === COMANDO PLAY ===
    if(command === 'play') {
        const url = args[0];
        if(!url) {
            message.reply('Por favor, proporciona una URL de YouTube.');
            return;
        }

        const voiceChannel = message.member?.voice.channel;
        if(!voiceChannel) {
            message.reply('¡Debes estar en un canal de voz!');
            return;
        }

        // Verificar si ya tenemos una suscripción para este servidor
        let subscription = subscriptions.get(message.guild.id);

        // Si no hay suscripción, crear una
        if(!subscription) {
            // Crear una conexión
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
                selfDeaf: true
            });

            // Crear un reproductor de audio
            const audioPlayer = createAudioPlayer({
                behaviors: {
                    noSubscriber: NoSubscriberBehavior.Stop
                }
            });

            // Escuchar los cambios de estado del AudioPlayer
            audioPlayer.on('stateChange', (oldState, newState) => {
                // Cuando el reproductor pasa de "reproduciendo" a "inactivo",
                // significa que terminó la pista actual
                if(oldState.status === AudioPlayerStatus.Playing && newState.status === AudioPlayerStatus.Idle) {
                    playNext(message.guild.id);
                }
            });

            // Suscribir la conexión al reproductor de audio
            connection.subscribe(audioPlayer);

            // Inicializar la suscripción
            subscription = {
                connection,
                audioPlayer,
                queue: [],
                ytdlProcess: null
            };
            subscriptions.set(message.guild.id, subscription);
        }

        // Agregar la pista a la cola
        subscription.queue.push(url);

        // Si el reproductor está inactivo (no se está reproduciendo nada), empezar inmediatamente.
        if(subscription.audioPlayer.state.status === AudioPlayerStatus.Idle) {
            playNext(message.guild.id);
            message.reply(`Ahora transmitiendo: ${url}`);
        }else {
            // De lo contrario, informar al usuario que está en la cola
            message.reply(`Agregado a la cola: ${url}`);
        }

    // === COMANDO STOP ===
    }else if(command === 'stop') {
        const subscription = subscriptions.get(message.guild.id);
        if(!subscription) {
            message.reply('¡No estoy reproduciendo nada en este servidor!');
            return;
        }

        // Podemos intentar detener de manera elegante
        if(subscription.ytdlProcess && !subscription.ytdlProcess.killed) {
            // Si lo deseas, puedes usar 'SIGTERM' o 'SIGKILL' - el controlador global abajo lo capturará
            subscription.ytdlProcess.kill('SIGTERM');
            subscription.ytdlProcess = null;
        }

        // Detener el audio y desconectar
        subscription.audioPlayer.stop();
        subscription.connection.destroy();
        subscriptions.delete(message.guild.id);

        message.reply('Reproducción detenida y desconectado.');

    // === COMANDO SKIP ===
    }else if(command === 'skip') {
        const subscription = subscriptions.get(message.guild.id);
        if(!subscription) {
            message.reply('¡No se está reproduciendo nada en este momento!');
            return;
        }

        // Detener el AudioPlayer desencadenará playNext() en el cambio de estado
        subscription.audioPlayer.stop();
        message.reply('Saltando la pista actual...');
    }
});

/**
 * Solución para evitar que el bot se caiga si se desconecta manualmente:
 * Si el bot está en un canal de voz y alguien lo desconecta,
 * este manejador de eventos eliminará su suscripción para evitar que se caiga.
 */
client.on('voiceStateUpdate', (oldState, newState) => {
    // Verificar si el bot mismo fue desconectado
    if(oldState.member && oldState.member.id === client.user.id && !newState.channelId) {
        // El bot fue desconectado
        const subscription = subscriptions.get(oldState.guild.id);
        if(subscription) {
            subscription.audioPlayer.stop();

            if(subscription.ytdlProcess && !subscription.ytdlProcess.killed) {
                subscription.ytdlProcess.kill('SIGTERM');
            }

            subscriptions.delete(oldState.guild.id);
        }
    }
});

/**
 * Manejador global de excepciones
 * 
 * tinyspawn (usado internamente por youtube-dl-exec) lanza un ChildProcessError
 * si el proceso termina por una señal (SIGTERM, SIGKILL, etc.). Interceptamos
 * ese error aquí para evitar que el bot se caiga.
 */
process.on('uncaughtException', (err) => {
    // Verificar si es un ChildProcessError de tinyspawn
    if(err && err.name === 'ChildProcessError' && err.signalCode) {
        // Es por matar forzosamente el proceso hijo (SIGTERM, SIGKILL, etc.)
        // Lo registramos e ignoramos para que el bot no se caiga
        console.log(`[tinyspawn ChildProcessError] Ignorando error debido a signal=${err.signalCode}`);
    }else {
        // De lo contrario, dejar que se propague (o manejarlo como desees)
        console.error('Excepción no capturada:', err);
        process.exit(1);
    }
});

client.login(TOKEN);
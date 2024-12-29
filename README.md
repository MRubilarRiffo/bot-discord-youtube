# Serenade
A self-hosted Discord music bot for YouTube made using Node.js.<br/><br/>
After repeatedly dealing with unstable, broken, generally dysfunctional, and paywalled Discord bots just to be able to play YouTube audio in Discord, I decided to just make my own by using ffmpeg and youtube-dl. Ideally, this choice of technology should make it both easier to maintain as well as less likely to frequently break.

## Usage
Playing/Enqueueing: ```!play <youtubeURL>```  
Skipping Queue: ```!skip```  
Disconnecting/Stopping: ```!stop```

## Installation
### Installer
1. After installing Node.js, download the installer: [Installer](https://github.com/XTP3/Serenade/releases/download/Installer/InstallSerenade.js)
2. Place it within your primary installation directory, and run ```node InstallSerenade.js```.
3. Run: ```node index.js```

### Manual
1. Clone the repo.
2. Enter the directory with the project files.
3. Install the necessary dependencies: ```npm install```
4. Enter the ```Config.json``` file and modify as necessary.
5. Run: ```node index.js```

## Config
To use the bot, simply add your Discord bot token, located in the ```Config.json``` file under the key ```TOKEN```.
Additionally, you can customize your command prefix character by modifying the value associated with the key ```PREFIX``` (set to '!' by default).

## Requirements
- Node.js v16.9.0 (v18.x+ recommended)

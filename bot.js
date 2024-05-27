
const Discord           = require('discord.js');
const { prefix, token } = require('./botConfig.json');
const fs                = require('fs');
const bot               = new Discord.Client()
bot.commands            = new Discord.Collection();

const http              = require("http");
const port              = process.env.PORT || 3000;
http.createServer().listen(port);

var queue = new Map();

const commandFolders = fs.readdirSync('./commands');
console.log(commandFolders);
for (const folder of commandFolders) {
	const commandFiles= fs.readdirSync(`./commands/${folder}`).filter(file => file.endsWith('.js'));

	console.log(commandFiles);
	for (const file of commandFiles) {
		const command = require(`./commands/${folder}/${file}`);
		// set a new item in the Collection
		// with the key as the command name and the value as the exported module
		bot.commands.set(command.name, command);
	}
}

bot.on('ready', () => {
    console.log('Hi, I\'m ',bot.user.tag, 'and I\'m online');
	bot.user.setActivity("a movie", { type: "WATCHING" });
});

bot.on('message', async (message) => {

	if (!message.content.startsWith(prefix) || message.author.bot ) return;

	const args = message.content.slice(prefix.length).split(/ +/);
	const cmdName = args.shift().toLowerCase(); //shift() borra el primer elemento [0] del array al que se lo aplica

	//console.log(cmdName, args);

	//Dynamically executing commands 
	const cmd = bot.commands.get(cmdName) || bot.commands.find(c => c.aliases && c.aliases.includes(cmdName));

	if (!cmd) return;

	if (cmd.args && !args.length) {
		let reply = `Me falta mas información para hacer eso, ${message.author}!`;

		if (cmd.usage) {
			reply += `\nDeberias poner el comando así: \`${prefix}${cmd.name} ${cmd.usage}\``;
		}

		return message.channel.send(reply);
	}

	if (cmd.guildOnly && message.channel.type !== 'text') {
		return message.reply('No puedo realizar esto en mensaje privado, lo siento');
	}

	if (cmd.adminOnly && !message.member.hasPermission("ADMINISTRATOR")) {
		return message.reply("No tenes tanto poder aqui, maldito inutil");
	}

	try {
		cmd.execute(message, args, queue);
	} 
	catch (error) {
		console.error(error);
		message.reply('Ups, algo salio mal y no pude realizar lo que me pediste, intentare arreglarlo lo antes posible');
	}

}); //FINISH BOT MESSAGE

bot.login(process.env.BOT_TOKEN || token);

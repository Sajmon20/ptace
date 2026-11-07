import { 
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
  ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder, 
  ModalBuilder, TextInputBuilder, TextInputStyle 
} from 'discord.js';
import cron from 'node-cron';
import axios from 'axios';
import { GoogleGenAI } from '@google/genai';
import { db, ref, get, set, remove } from './firebase.js';
import dotenv from 'dotenv';
dotenv.config();

const OWNER_ID = "870947170407313418";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages]
});

// Inicializace Google GenAI (využívá GEMINI_API_KEY z prostředí)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Funkce pro získání detailního počasí v °C (ráno, poledne, večer přes wttr.in)
async function getWeather(city = "Opava") {
  try {
    // S hlavičkou curl vrátí wttr.in krásnou textovou předpověď včetně částí dne a °C
    const res = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=3`, { 
      headers: { 'User-Agent': 'curl' },
      responseType: 'text' 
    });
    return res.data.trim();
  } catch (e) {
    return "Počasí momentálně není k dispozici.";
  }
}

// Funkce pro generování obsahu pomocí AI (svátky, události, novinky, doporučení)
async function getAIGeneratedContent(cityName) {
  const todayStr = new Date().toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
  const weatherData = await getWeather(cityName);

  const prompt = `
Dnes je ${todayStr}. Jsi chytrý ranní asistent pro Discord bota "Ranní ptáče".
Pro město "${cityName}" je aktuální předpověď počasí: "${weatherData}".

Vrať mi odpověď POUZE jako čistý JSON objekt (bez jakýchkoliv markdown značek jako \`\`\`json, jen čistý řetězec JSON) s těmito přesnými klíči:
- "svatek": Přesné jméno/jména lidí, kteří mají dnes v České republice svátek.
- "udalost": Státní svátek, významný den nebo historická událost připadající na dnešní den v ČR (pokud je to běžný pracovní den bez významu, napiš "Běžný pracovní den" nebo uveď co se slaví).
- "novinky": Krátká, zajímavá zpráva, technologický nebo světový střípek z včerejšího dne (1-2 věty).
- "doporuceni": Praktické ranní doporučení pro uživatele na základě počasí a dne (např. "Vezmi si deštník, odpoledne bude pršet", "Nezapomeň sluneční brýle", "Venku mrzne, obleč se teple").
- "zajimavost": Krátká zajímavost nebo tip do nového dne.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const text = response.text.trim();
    const cleanedJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanedJson);
  } catch (err) {
    console.error("Chyba při generování AI obsahu:", err);
    return {
      svatek: "Dnes má svátek dle kalendáře",
      udalost: "Běžný den",
      novinky: "Včerejšek přinesl zajímavé novinky ze světa technologií i událostí.",
      doporuceni: "Měj parádní den, úsměv na tváři a dobrou náladu!",
      zajimavost: "Pravidelný ranní režim prokazatelně zvyšuje produktivitu."
    };
  }
}

// Hlavní funkce pro rozesílku ranního přehledu
async function sendMorningNews() {
  const snapshot = await get(ref(db, 'subscribers'));
  if (!snapshot.exists()) return;

  const subscribers = snapshot.val();
  const todayFormatted = new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  for (const [userId, data] of Object.entries(subscribers)) {
    if (!data.active) continue;

    try {
      const city = data.city || 'Opava';
      const aiData = await getAIGeneratedContent(city);
      const weatherText = await getWeather(city);
      
      const embed = new EmbedBuilder()
        .setColor('#00FFA3')
        .setTitle(`🌅 Dobré ráno, Ranní ptáče!`)
        .setDescription(`📅 **Dnes je:** ${todayFormatted}`)
        .addFields(
          { name: '🎉 Svátek & Významné události', value: `• **Svátek:** ${aiData.svatek}\n• **Událost:** ${aiData.udalost}`, inline: false },
          { name: `⛅ Počasí v °C (${city})`, value: `\`\`\`${weatherText}\`\`\``, inline: false },
          { name: '💡 Ranní doporučení', value: `👉 ${aiData.doporuceni}`, inline: false },
          { name: '📰 Novinky ze včerejška', value: aiData.novinky, inline: false },
          { name: '✨ Dnešní zajímavost', value: aiData.zajimavost, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Ranní ptáče • Poháněno AI & Google Gemini' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('unsub_btn')
          .setLabel('Zrušit odběr')
          .setStyle(ButtonStyle.Danger)
      );

      const user = await client.users.fetch(userId);
      await user.send({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error(`Nepodařilo se poslat zprávu uživateli ${userId}:`, err.message);
    }
  }
}

client.once('ready', async () => {
  console.log(`🤖 Bot ${client.user.tag} je online!`);

  const commands = [
    new SlashCommandBuilder()
      .setName('adminpanel')
      .setDescription('Otevře administrátorský panel bota (pouze majitel)'),
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Odešle interaktivní panel pro odběratele do tohoto kanálu')
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash příkazy registrovány.');
  } catch (error) {
    console.error(error);
  }
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'adminpanel') {
        if (interaction.user.id !== OWNER_ID) {
          return interaction.reply({ content: '❌ Tento příkaz může používat pouze majitel bota.', ephemeral: true });
        }

        const adminEmbed = new EmbedBuilder()
          .setColor('#2b2d31')
          .setTitle('🛠️ Ranní ptáče – Admin Panel')
          .setDescription('Správa bota a AI generátoru.');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('admin_stats')
            .setLabel('📊 Statistiky')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('admin_test')
            .setLabel('🧪 Test rozesílky s AI')
            .setStyle(ButtonStyle.Success)
        );

        return interaction.reply({ embeds: [adminEmbed], components: [row], ephemeral: true });
      }

      if (interaction.commandName === 'setup') {
        if (interaction.user.id !== OWNER_ID) {
          return interaction.reply({ content: '❌ Pouze majitel.', ephemeral: true });
        }

        const publicEmbed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('🌅 Ranní ptáče – Odběr novinek')
          .setDescription('Chceš každé ráno dostávat do DM moderní přehled s aktuálním datem, svátky, počasím v °C, AI doporučením a novinkami ze včerejška?\n\nStiskni tlačítko níže!');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('open_sub_modal')
            .setLabel('🔔 Přihlásit se k odběru')
            .setStyle(ButtonStyle.Success)
        );

        await interaction.channel.send({ embeds: [publicEmbed], components: [row] });
        return interaction.reply({ content: '✅ Panel odeslán!', ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'open_sub_modal') {
        const modal = new ModalBuilder()
          .setCustomId('sub_modal')
          .setTitle('Nastavení odběru Ranního ptáčete');

        const cityInput = new TextInputBuilder()
          .setCustomId('city_input')
          .setLabel('Tvoje město (pro předpověď počasí):')
          .setPlaceholder('např. Opava')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(cityInput));
        return await interaction.showModal(modal);
      }

      if (interaction.customId === 'unsub_btn') {
        const userRef = ref(db, `subscribers/${interaction.user.id}`);
        await remove(userRef);
        return interaction.reply({ content: '🔕 Tvůj odběr byl úspěšně zrušen.', ephemeral: true });
      }

      if (interaction.customId === 'admin_stats') {
        if (interaction.user.id !== OWNER_ID) return;
        const snap = await get(ref(db, 'subscribers'));
        const count = snap.exists() ? Object.keys(snap.val()).length : 0;
        return interaction.reply({ content: `📊 Odběratelů: **${count}**`, ephemeral: true });
      }

      if (interaction.customId === 'admin_test') {
        if (interaction.user.id !== OWNER_ID) return;
        await interaction.reply({ content: '🧪 Spouštím testovací ranní rozesílku s AI...', ephemeral: true });
        await sendMorningNews();
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'sub_modal') {
        let city = interaction.fields.getTextInputValue('city_input').trim();
        if (!city) city = "Opava";

        const userId = interaction.user.id;
        const userRef = ref(db, `subscribers/${userId}`);

        await set(userRef, {
          city: city,
          active: true,
          username: interaction.user.tag
        });

        return interaction.reply({
          content: `✅ Přihlášeno! Každé ráno ti pošlu přehled pro město **${city}** v °C i s AI doporučením.\n*(Město nikde nesdílíme, slouží čistě pro počasí).*`,
          ephemeral: true
        });
      }
    }
  } catch (err) {
    console.error("Chyba:", err);
  }
});

// ⏰ Automatický cron – každé ráno v 6:00
cron.schedule('0 6 * * *', async () => {
  await sendMorningNews();
});

client.login(process.env.DISCORD_TOKEN);

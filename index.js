const { Client, LocalAuth } = require("whatsapp-web.js");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const qrcode = require("qrcode");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let client = new Client({
  authStrategy: new LocalAuth()
});

let isClientReady = false;
let messages = [];

// Emitir el QR si no hay sesión
client.on("qr", async (qr) => {
  if (isClientReady) return;
  console.log("⚡ QR recibido, escanéalo para iniciar sesión");
  try {
    const qrImage = await qrcode.toDataURL(qr);
    io.emit("qr", qrImage);
  } catch (err) {
    console.error("❌ Error al generar el QR:", err);
  }
});

// WhatsApp listo
client.on("ready", async () => {
  console.log("✅ WhatsApp conectado");
  isClientReady = true;
  io.emit("status", "conectado");

  try {
    const chats = await client.getChats();
    io.emit("lista_chats", chats); // Emitir lista de chats
  } catch (error) {
    console.error("❌ Error al obtener los chats:", error);
  }
});

// Recibir mensajes de WhatsApp
client.on("message", async (msg) => {
  const newMessage = { sender: msg.from, text: msg.body, name: msg._data.notifyName };
  messages.push(newMessage);
  io.emit("mensaje", newMessage);
});

// Manejo de WebSocket
io.on("connection", (socket) => {
  console.log("🔗 Cliente WebSocket conectado");

  socket.emit("status", isClientReady ? "conectado" : "desconectado");
  socket.emit("all_messages", messages);

  if (!isClientReady) {
    console.log("📢 No hay sesión, esperando escaneo de QR...");
  }

  // Obtener chats desde el frontend
  socket.on("obtener_chats", async () => {
    if (!isClientReady) {
      return socket.emit("error", "El cliente de WhatsApp no está listo.");
    }
    try {
      const chats = await client.getChats();
      socket.emit("lista_chats", chats);
    } catch (error) {
      console.error("❌ Error al obtener los chats:", error);
      socket.emit("error", "Error al obtener los chats.");
    }
  });


  // Seleccionar un chat y obtener mensajes
  socket.on("seleccionar_chat", async (chatId) => {
    if (!chatId) return socket.emit("mensajes_chat", []);

    try {
      const chat = await client.getChatById(chatId);
      const messages = await chat.fetchMessages({ limit: 50 });

      const messageData = messages.map(message => ({
        sender: message.fromMe ? "Tú" : message.sender?.pushname || message.from,
        text: message.body,
        timestamp: message.timestamp
      }));

      socket.emit("mensajes_chat", messageData);
    } catch (error) {
      console.error("❌ Error al obtener mensajes:", error);
      socket.emit("mensajes_chat", []);
    }
  });



  // Enviar mensaje
  socket.on("enviar_mensaje", async ({ chatId, message }) => {
    if (!chatId || !message) {
      console.error("❌ Error: chatId o mensaje no válidos.");
      return;
    }

    const phoneNumber = chatId.includes("@") ? chatId : `${chatId}@c.us`; // Asegurar formato correcto

    try {
      const chat = await client.getChatById(phoneNumber); // Obtener el chat
      await chat.sendMessage(message); // Enviar mensaje
      console.log(`✅ Mensaje enviado a ${phoneNumber}`);
      socket.emit("mensaje_enviado", { success: true, chatId, message });
    } catch (error) {
      console.error("❌ Error al enviar el mensaje:", error);
      socket.emit("error", { error: "No se pudo enviar el mensaje. Verifica el número." });
    }
  });


  // Cerrar sesión en WhatsApp
  socket.on("cerrar_sesion", async () => {
    console.log("⚠️ Cerrando sesión en WhatsApp...");
  
    io.emit("status", "desconectado");
  
    try {
      await client.logout();
      console.log("✅ Sesión cerrada correctamente");
    } catch (error) {
      console.error("❌ Error al cerrar sesión:", error);
    }
  
    // Reiniciar variables
    isClientReady = false;
    messages = [];
  
    // Destruir cliente actual antes de crear uno nuevo
    if (client) {
      try {
        await client.destroy();
        console.log("✅ Cliente destruido correctamente");
      } catch (error) {
        console.error("❌ Error al destruir el cliente:", error);
      }
    }
  
    // Crear un nuevo cliente
    client = new Client({ authStrategy: new LocalAuth() });
  
    // Capturar el evento para el nuevo QR
    client.on("qr", async (qr) => {
      console.log("📌 Nuevo código QR generado");
  
      try {
        const qrImage = await qrcode.toDataURL(qr);
        io.emit("qr", qrImage); // Emitir el QR en formato de imagen al frontend
      } catch (error) {
        console.error("❌ Error al generar imagen QR:", error);
      }
    });
  
    // Evento cuando el cliente está listo
    client.on("ready", () => {
      console.log("✅ Cliente de WhatsApp listo");
      isClientReady = true;
      io.emit("status", "conectado");
    });
  
    // Inicializar el nuevo cliente
    client.initialize();
    console.log("🔄 Cliente reinicializado, esperando nuevo QR...");
  });


  socket.on("disconnect", () => {
    console.log("❌ Cliente WebSocket desconectado");
  });
});

client.initialize();

server.listen(3000, () => {
  console.log("🚀 Servidor corriendo en http://localhost:3000");
});

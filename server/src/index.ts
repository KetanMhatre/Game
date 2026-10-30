import { defineRoom, defineServer, WebSocketTransport } from 'colyseus';
import { NutshellRoom } from './NutshellRoom.ts';

// Nutshell Navy multiplayer server.
//   public  → Quick Play matchmaking (joinOrCreate), rooms run matches back to back.
//   private → created with a 5-letter code; friends join by code (joinById).
const port = Number(process.env.PORT ?? 2567);

const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: {
    public: defineRoom(NutshellRoom),
    private: defineRoom(NutshellRoom),
  },
});

server.listen(port).then(() => {
  console.log(`Nutshell Navy server listening on ws://localhost:${port}`);
});

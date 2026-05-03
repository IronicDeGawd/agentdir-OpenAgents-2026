// Mongo init script — runs only on FIRST container boot when /data/db is
// empty. Creates the application user with scoped permissions on the
// `agentdir` database. The root user remains for ops only and should
// never be used by the app.
//
// Env vars are injected by docker-compose at container start:
//   AGENTDIR_APP_USER, AGENTDIR_APP_PW

const appUser = process.env.AGENTDIR_APP_USER;
const appPw = process.env.AGENTDIR_APP_PW;

if (!appUser || !appPw) {
  print("[init] AGENTDIR_APP_USER / AGENTDIR_APP_PW not set — skipping app user creation");
} else {
  db = db.getSiblingDB("agentdir");
  db.createUser({
    user: appUser,
    pwd: appPw,
    roles: [{ role: "readWrite", db: "agentdir" }],
    mechanisms: ["SCRAM-SHA-256"],
  });
  print(`[init] created app user '${appUser}' with readWrite on agentdir`);
}

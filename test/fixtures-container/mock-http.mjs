const homeCoach = {
  body: {
    devices: [{
      module_name: "CI Home Coach",
      dashboard_data: { Temperature: 20, time_utc: Math.floor(Date.now() / 1000) }
    }]
  }
};
const homes = {
  body: { homes: [{ id: "ci-home-id", name: "CI Home", rooms: [{ id: "ci-room-id", name: "CI Room" }] }] }
};
const status = {
  body: { home: { rooms: [{ id: "ci-room-id", therm_measured_temperature: 19.5 }] } }
};

globalThis.fetch = async (input) => {
  const url = new URL(input);
  if (url.hostname !== "api.netatmo.com") throw new Error("Unexpected fixture host");
  let body;
  if (url.pathname === "/api/gethomecoachsdata") body = homeCoach;
  else if (url.pathname === "/api/homesdata") body = homes;
  else if (url.pathname === "/api/homestatus" && url.searchParams.get("home_id") === "ci-home-id") body = status;
  else throw new Error("Unexpected fixture request");
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};

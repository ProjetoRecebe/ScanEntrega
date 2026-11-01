const employees = [
  {
    id: "employee-ana",
    name: "Ana Silva",
    email: "ana@demo.scanentrega",
    password: "1234",
    condominiumIds: ["condo-recife", "condo-olinda"],
  },
  {
    id: "employee-carlos",
    name: "Carlos Souza",
    email: "carlos@demo.scanentrega",
    password: "1234",
    condominiumIds: ["condo-sao-paulo"],
  },
];

const condominiums = [
  {
    id: "condo-recife",
    name: "Residencial Exemplo Recife",
    latitude: -8.0476,
    longitude: -34.877,
    radiusMeters: 250,
  },
  {
    id: "condo-olinda",
    name: "Residencial Exemplo Olinda",
    latitude: -8.0089,
    longitude: -34.8553,
    radiusMeters: 250,
  },
  {
    id: "condo-sao-paulo",
    name: "Residencial Exemplo São Paulo",
    latitude: -23.5505,
    longitude: -46.6333,
    radiusMeters: 250,
  },
];

const MAX_ACCURACY_METERS = 100;
const EARTH_RADIUS_METERS = 6_371_000;

export async function loginDemo(email, password) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const employee = employees.find((candidate) =>
    candidate.email === email.trim().toLowerCase() && candidate.password === password,
  );
  if (!employee) throw new Error("E-mail ou senha de demonstração inválidos.");
  const { id, name, email: normalizedEmail } = employee;
  return { id, name, email: normalizedEmail };
}

export function getAssignedCondominiums(employeeId) {
  const employee = employees.find((candidate) => candidate.id === employeeId);
  if (!employee) throw new Error("Funcionário de demonstração não encontrado.");
  return employee.condominiumIds.map((id) => {
    const condominium = condominiums.find((candidate) => candidate.id === id);
    if (!condominium) throw new Error(`Condomínio de demonstração não encontrado: ${id}.`);
    return { ...condominium };
  });
}

function distanceMeters(first, second) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function validateMockLocation(condominium, location) {
  if (
    !Number.isFinite(location.latitude)
    || !Number.isFinite(location.longitude)
    || !Number.isFinite(location.accuracyMeters)
    || location.latitude < -90
    || location.latitude > 90
    || location.longitude < -180
    || location.longitude > 180
    || location.accuracyMeters < 0
  ) {
    throw new Error("A localização recebida é inválida.");
  }

  const distance = distanceMeters(condominium, location);
  const accuracyIsAcceptable = location.accuracyMeters <= MAX_ACCURACY_METERS;
  const insideWithAccuracy = distance + location.accuracyMeters <= condominium.radiusMeters;

  return {
    ...location,
    distanceMeters: Math.round(distance),
    validatedAt: new Date().toISOString(),
    condominiumId: condominium.id,
    condominiumName: condominium.name,
    radiusMeters: condominium.radiusMeters,
    status: !accuracyIsAcceptable
      ? "insufficient_accuracy"
      : insideWithAccuracy
        ? "approved"
        : "outside",
    approved: accuracyIsAcceptable && insideWithAccuracy,
    reason: !accuracyIsAcceptable
      ? `Precisão insuficiente (${Math.round(location.accuracyMeters)} m). Tente novamente em um local aberto.`
      : insideWithAccuracy
        ? `Local confirmado a ${Math.round(distance)} m do ponto cadastrado.`
        : `Local fora da área permitida (${Math.round(distance)} m; limite de ${condominium.radiusMeters} m).`,
  };
}

export function getDeviceLocation() {
  if (!navigator.geolocation) {
    return Promise.reject(new Error("Este navegador não disponibiliza a localização do aparelho."));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracyMeters: coords.accuracy,
        source: "gps",
        isMock: false,
      }),
      (error) => {
        const messages = {
          1: "Permissão de localização negada. Autorize o acesso e tente novamente.",
          2: "Não foi possível determinar a localização. Verifique o GPS e tente novamente.",
          3: "A localização demorou demais. Tente novamente.",
        };
        reject(new Error(messages[error.code] ?? "Falha ao obter a localização do aparelho."));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  });
}

export function getDemoLocation(condominium, mode) {
  if (mode === "demo-inside") {
    return {
      latitude: condominium.latitude,
      longitude: condominium.longitude,
      accuracyMeters: 20,
      source: mode,
      isMock: true,
    };
  }
  if (mode === "demo-outside") {
    return {
      latitude: condominium.latitude + 0.02,
      longitude: condominium.longitude,
      accuracyMeters: 20,
      source: mode,
      isMock: true,
    };
  }
  if (mode === "demo-inaccurate") {
    return {
      latitude: condominium.latitude,
      longitude: condominium.longitude,
      accuracyMeters: 500,
      source: mode,
      isMock: true,
    };
  }
  throw new Error("Modo de demonstração de localização inválido.");
}

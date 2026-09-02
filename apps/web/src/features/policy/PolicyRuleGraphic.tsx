import type { ReactNode } from "react";
import type { PolicyRule } from "@highlife/shared-types";
import { ruleBands, type PolicyGraphicKind } from "@/lib/policy/policyExplain";

function Svg({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg
      viewBox="0 0 220 92"
      className="h-auto w-full"
      role="img"
      aria-label={label}
    >
      {children}
    </svg>
  );
}

function AptSizeGraphic({ rule }: { rule: PolicyRule }) {
  const bands = ruleBands(rule);
  if (!bands.length) {
    const area = rule.minAreaM2;
    return (
      <Svg label="Minimum internal apartment size">
        <rect x="40" y="14" width="140" height="52" rx="3" fill="#f0fdfa" stroke="#0f766e" strokeWidth="1.2" />
        <text x="110" y="40" textAnchor="middle" fill="#115e59" fontSize="9" fontWeight="600">
          Apartment
        </text>
        <text x="110" y="82" textAnchor="middle" fill="#334155" fontSize="8">
          {area != null ? `≥ ${area} m² internal` : "Minimum internal area"}
        </text>
      </Svg>
    );
  }
  const gap = 6;
  const left = 8;
  const usable = 204 - gap * (bands.length - 1);
  const weights = bands.map((b) => Math.sqrt(b.value));
  const sum = weights.reduce((acc, w) => acc + w, 0);
  const widths = weights.map((w) => (w / sum) * usable);
  let x = left;
  return (
    <Svg label="Minimum internal apartment sizes by bedroom count">
      {bands.map((band, i) => {
        const w = widths[i];
        const h = 48;
        const y = 8;
        const beds = band.key === "0" ? 0 : band.key === "3" ? 3 : Number(band.key);
        const cell = Math.min(11, Math.max(7, (w - 10) / Math.max(beds, 1) - 2));
        const node = (
          <g key={band.key}>
            <rect x={x} y={y} width={w} height={h} rx={3} fill="#f0fdfa" stroke="#0f766e" strokeWidth="1.2" />
            {beds === 0 ? (
              <rect x={x + 4} y={y + 16} width={w - 8} height={h - 24} rx={1.5} fill="#ccfbf1" />
            ) : (
              Array.from({ length: beds }, (_, j) => (
                <rect
                  key={j}
                  x={x + 5 + j * (cell + 2)}
                  y={y + h - cell - 6}
                  width={cell}
                  height={cell}
                  rx={1.2}
                  fill="#99f6e4"
                  stroke="#0f766e"
                  strokeWidth="0.6"
                />
              ))
            )}
            <text x={x + w / 2} y={y + 13} textAnchor="middle" fill="#115e59" fontSize="7.5" fontWeight="600">
              {band.label}
            </text>
            <text x={x + w / 2} y={y + h + 14} textAnchor="middle" fill="#334155" fontSize="8" fontWeight="600">
              {band.value} m²
            </text>
          </g>
        );
        x += w + gap;
        return node;
      })}
    </Svg>
  );
}

function LivingGraphic({ rule }: { rule: PolicyRule }) {
  const dim = rule.minDimensionM;
  return (
    <Svg label="Living room highlighted inside an apartment">
      <rect x="18" y="10" width="130" height="64" rx="3" fill="#f8fafc" stroke="#64748b" strokeWidth="1.2" />
      <rect x="24" y="16" width="72" height="52" rx="2" fill="#fef3c7" stroke="#d97706" strokeWidth="1.1" />
      <text x="60" y="40" textAnchor="middle" fill="#92400e" fontSize="8" fontWeight="600">
        Living
      </text>
      {dim != null ? (
        <>
          <path d="M24 72 L24 80 L96 80 L96 72" fill="none" stroke="#d97706" strokeWidth="0.9" />
          <text x="60" y="88" textAnchor="middle" fill="#92400e" fontSize="7">
            min {dim} m wide
          </text>
        </>
      ) : null}
      <rect x="100" y="16" width="40" height="24" rx="1.5" fill="#e2e8f0" stroke="#64748b" strokeWidth="0.7" />
      <text x="120" y="31" textAnchor="middle" fill="#475569" fontSize="7">
        Bed
      </text>
      <rect x="100" y="44" width="40" height="24" rx="1.5" fill="#e2e8f0" stroke="#64748b" strokeWidth="0.7" />
      <text x="120" y="59" textAnchor="middle" fill="#475569" fontSize="7">
        Bed
      </text>
      <rect x="156" y="28" width="46" height="28" rx="2" fill="#ecfeff" stroke="#0891b2" strokeWidth="1" />
      <text x="179" y="45" textAnchor="middle" fill="#155e75" fontSize="7">
        Balcony
      </text>
    </Svg>
  );
}

function PosGraphic({ rule }: { rule: PolicyRule }) {
  const dim = rule.minDimensionM ?? 1.8;
  const area = rule.byBedrooms?.["1"] ?? rule.minAreaM2 ?? 8;
  return (
    <Svg label="Private balcony with minimum depth">
      <rect x="16" y="14" width="118" height="56" rx="3" fill="#f8fafc" stroke="#64748b" strokeWidth="1.2" />
      <text x="75" y="44" textAnchor="middle" fill="#64748b" fontSize="8">
        Apartment
      </text>
      <rect x="142" y="20" width="52" height="44" rx="2" fill="#dcfce7" stroke="#16a34a" strokeWidth="1.2" />
      <text x="168" y="42" textAnchor="middle" fill="#166534" fontSize="7.5" fontWeight="600">
        POS
      </text>
      <text x="168" y="52" textAnchor="middle" fill="#166534" fontSize="7">
        {area} m²
      </text>
      <path d="M198 22 L204 22 L204 62 L198 62" fill="none" stroke="#16a34a" strokeWidth="0.9" />
      <text x="110" y="88" textAnchor="middle" fill="#166534" fontSize="7">
        Usable depth ≥ {dim} m
      </text>
    </Svg>
  );
}

function BedroomGraphic({ rule }: { rule: PolicyRule }) {
  const area = rule.minAreaM2 ?? 9;
  const dim = rule.minDimensionM ?? 3;
  return (
    <Svg label="Bedroom minimum area and width">
      <rect x="40" y="10" width="100" height="58" rx="3" fill="#e0e7ff" stroke="#4f46e5" strokeWidth="1.2" />
      <rect x="48" y="36" width="36" height="24" rx="2" fill="#c7d2fe" />
      <text x="90" y="30" textAnchor="middle" fill="#3730a3" fontSize="8" fontWeight="600">
        Bedroom ≥ {area} m²
      </text>
      <path d="M40 74 L40 82 L140 82 L140 74" fill="none" stroke="#4f46e5" strokeWidth="0.9" />
      <text x="90" y="90" textAnchor="middle" fill="#3730a3" fontSize="7">
        min {dim} m
      </text>
    </Svg>
  );
}

function BathroomGraphic() {
  return (
    <Svg label="Bathroom required in each dwelling">
      <rect x="22" y="12" width="176" height="64" rx="3" fill="#f8fafc" stroke="#64748b" strokeWidth="1.1" />
      <rect x="30" y="20" width="88" height="48" rx="2" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="0.7" />
      <text x="74" y="46" textAnchor="middle" fill="#64748b" fontSize="8">
        Living
      </text>
      <rect x="126" y="20" width="62" height="48" rx="2" fill="#fce7f3" stroke="#db2777" strokeWidth="1.1" />
      <circle cx="148" cy="44" r="7" fill="none" stroke="#be185d" strokeWidth="1.1" />
      <rect x="162" y="32" width="16" height="22" rx="1.5" fill="#fbcfe8" stroke="#be185d" strokeWidth="0.8" />
      <text x="157" y="78" textAnchor="middle" fill="#9d174d" fontSize="7" fontWeight="600">
        Bathroom
      </text>
    </Svg>
  );
}

function StorageGraphic() {
  return (
    <Svg label="In-dwelling store or robe">
      <rect x="22" y="12" width="176" height="64" rx="3" fill="#f8fafc" stroke="#64748b" strokeWidth="1.1" />
      <rect x="30" y="20" width="100" height="48" rx="2" fill="#f1f5f9" />
      <text x="80" y="46" textAnchor="middle" fill="#64748b" fontSize="8">
        Apartment
      </text>
      <rect x="138" y="20" width="50" height="48" rx="2" fill="#ffedd5" stroke="#ea580c" strokeWidth="1.1" />
      <path d="M148 28 L178 28 M148 36 L178 36 M148 44 L178 44 M148 52 L178 52" stroke="#c2410c" strokeWidth="0.8" />
      <text x="163" y="78" textAnchor="middle" fill="#9a3412" fontSize="7" fontWeight="600">
        Store / robe
      </text>
    </Svg>
  );
}

function DualAspectGraphic() {
  return (
    <Svg label="Dual aspect apartment with windows on two sides">
      <rect x="50" y="16" width="120" height="52" rx="3" fill="#f8fafc" stroke="#64748b" strokeWidth="1.2" />
      <rect x="46" y="30" width="6" height="22" rx="1" fill="#38bdf8" />
      <rect x="168" y="30" width="6" height="22" rx="1" fill="#38bdf8" />
      <path d="M56 41 H164" fill="none" stroke="#0284c7" strokeWidth="1.1" strokeDasharray="3 2" />
      <path d="M164 41 L158 37 M164 41 L158 45" stroke="#0284c7" strokeWidth="1" />
      <text x="110" y="58" textAnchor="middle" fill="#0369a1" fontSize="8" fontWeight="600">
        Cross-breeze
      </text>
      <text x="110" y="86" textAnchor="middle" fill="#334155" fontSize="7">
        Windows on two sides
      </text>
    </Svg>
  );
}

function CommunalGraphic({ rule }: { rule: PolicyRule }) {
  const per = rule.m2PerDwelling ?? 2.5;
  return (
    <Svg label="Communal courtyard shared by dwellings">
      <rect x="16" y="10" width="52" height="36" rx="2" fill="#e2e8f0" stroke="#64748b" strokeWidth="0.8" />
      <rect x="152" y="10" width="52" height="36" rx="2" fill="#e2e8f0" stroke="#64748b" strokeWidth="0.8" />
      <rect x="16" y="50" width="52" height="28" rx="2" fill="#e2e8f0" stroke="#64748b" strokeWidth="0.8" />
      <rect x="152" y="50" width="52" height="28" rx="2" fill="#e2e8f0" stroke="#64748b" strokeWidth="0.8" />
      <rect x="76" y="16" width="68" height="56" rx="3" fill="#dcfce7" stroke="#16a34a" strokeWidth="1.2" />
      <text x="110" y="42" textAnchor="middle" fill="#166534" fontSize="8" fontWeight="600">
        Courtyard
      </text>
      <text x="110" y="54" textAnchor="middle" fill="#166534" fontSize="7">
        {per} m² × dwellings
      </text>
    </Svg>
  );
}

function RoomAreaGraphic({ rule }: { rule: PolicyRule }) {
  return (
    <Svg label="Room area minimum">
      <rect x="50" y="12" width="120" height="56" rx="3" fill="#dbeafe" stroke="#2563eb" strokeWidth="1.2" />
      <text x="110" y="40" textAnchor="middle" fill="#1d4ed8" fontSize="8" fontWeight="600">
        {rule.roomLabels?.[0] ?? "Room"}
      </text>
      <text x="110" y="54" textAnchor="middle" fill="#1e40af" fontSize="8">
        ≥ {rule.minAreaM2 ?? "min"} m²
      </text>
    </Svg>
  );
}

function RequiredRoomsGraphic({ rule }: { rule: PolicyRule }) {
  const labels = (rule.requiredLabels ?? ["Bedroom", "Bathroom"]).slice(0, 4);
  return (
    <Svg label="Required room types">
      {labels.map((name, i) => (
        <g key={name}>
          <rect x="28" y={12 + i * 18} width="12" height="12" rx="2" fill="#dcfce7" stroke="#16a34a" strokeWidth="1" />
          <path d={`M31 ${18 + i * 18} l3 3 l5 -6`} fill="none" stroke="#15803d" strokeWidth="1.2" />
          <text x="48" y={22 + i * 18} fill="#334155" fontSize="9">
            {name}
          </text>
        </g>
      ))}
    </Svg>
  );
}

function HabitableWindowGraphic() {
  return (
    <Svg label="Habitable room with an exterior window">
      <rect x="28" y="14" width="88" height="56" rx="3" fill="#dbeafe" stroke="#2563eb" strokeWidth="1.2" />
      <rect x="108" y="28" width="10" height="28" rx="1" fill="#e0f2fe" stroke="#0284c7" strokeWidth="1.2" />
      <rect x="128" y="14" width="64" height="56" rx="3" fill="#ccfbf1" stroke="#0f766e" strokeWidth="1.2" />
      <text x="72" y="46" textAnchor="middle" fill="#1d4ed8" fontSize="8" fontWeight="600">
        Bedroom
      </text>
      <text x="160" y="46" textAnchor="middle" fill="#0f766e" fontSize="8" fontWeight="600">
        Living
      </text>
      <text x="110" y="86" textAnchor="middle" fill="#334155" fontSize="7">
        Window on the room contour
      </text>
    </Svg>
  );
}

function WallsGraphic() {
  return (
    <Svg label="Wall geometry on the plan">
      <path d="M30 20 H190 V72 H30 Z" fill="none" stroke="#ca8a04" strokeWidth="4" strokeLinejoin="round" />
      <path d="M80 20 V72 M140 20 V50" stroke="#ca8a04" strokeWidth="4" />
      <text x="110" y="88" textAnchor="middle" fill="#854d0e" fontSize="7">
        Detected wall regions
      </text>
    </Svg>
  );
}

function SolarGraphic() {
  return (
    <Svg label="Mid-winter sun reaching living rooms">
      <circle cx="36" cy="22" r="10" fill="#fde68a" stroke="#d97706" strokeWidth="1" />
      <path d="M48 28 L92 48" stroke="#f59e0b" strokeWidth="1.4" />
      <path d="M50 20 L100 42" stroke="#fbbf24" strokeWidth="1.2" />
      <rect x="92" y="30" width="100" height="42" rx="3" fill="#f8fafc" stroke="#64748b" strokeWidth="1.1" />
      <rect x="100" y="38" width="48" height="26" rx="2" fill="#fef3c7" stroke="#d97706" strokeWidth="0.9" />
      <text x="124" y="54" textAnchor="middle" fill="#92400e" fontSize="7" fontWeight="600">
        Living
      </text>
      <text x="110" y="86" textAnchor="middle" fill="#92400e" fontSize="7">
        Direct sun 9am–3pm mid-winter
      </text>
    </Svg>
  );
}

function VentilationGraphic() {
  return (
    <Svg label="Natural ventilation through the apartment">
      <rect x="40" y="16" width="140" height="50" rx="3" fill="#f8fafc" stroke="#64748b" strokeWidth="1.2" />
      <rect x="36" y="28" width="6" height="24" rx="1" fill="#38bdf8" />
      <rect x="178" y="28" width="6" height="24" rx="1" fill="#38bdf8" />
      <path d="M48 40 C80 28, 120 52, 172 40" fill="none" stroke="#0284c7" strokeWidth="1.2" />
      <text x="110" y="84" textAnchor="middle" fill="#0369a1" fontSize="7">
        Depth, openable area, or opposite openings
      </text>
    </Svg>
  );
}

function CirculationGraphic() {
  return (
    <Svg label="Corridor width and cores">
      <rect x="16" y="14" width="44" height="56" rx="2" fill="#e2e8f0" stroke="#64748b" strokeWidth="0.8" />
      <rect x="160" y="14" width="44" height="56" rx="2" fill="#e2e8f0" stroke="#64748b" strokeWidth="0.8" />
      <rect x="68" y="28" width="84" height="28" rx="2" fill="#e0e7ff" stroke="#4f46e5" strokeWidth="1.1" />
      <path d="M76 42 H144" stroke="#4338ca" strokeWidth="1.2" markerEnd="url(#arr)" />
      <text x="110" y="46" textAnchor="middle" fill="#3730a3" fontSize="8" fontWeight="600">
        Corridor
      </text>
      <text x="110" y="86" textAnchor="middle" fill="#4338ca" fontSize="7">
        Width, length, or apartments per core
      </text>
    </Svg>
  );
}

function AcousticGraphic() {
  return (
    <Svg label="Acoustic separation between dwellings">
      <rect x="18" y="16" width="80" height="52" rx="2" fill="#f8fafc" stroke="#64748b" strokeWidth="1" />
      <rect x="122" y="16" width="80" height="52" rx="2" fill="#f8fafc" stroke="#64748b" strokeWidth="1" />
      <rect x="96" y="16" width="28" height="52" fill="#fef3c7" stroke="#d97706" strokeWidth="1.2" />
      <text x="110" y="46" textAnchor="middle" fill="#92400e" fontSize="7" fontWeight="600">
        Wall
      </text>
      <text x="110" y="86" textAnchor="middle" fill="#854d0e" fontSize="7">
        Rw rating / room adjacency
      </text>
    </Svg>
  );
}

function OutlookGraphic() {
  return (
    <Svg label="Outlook and visual privacy setback">
      <rect x="16" y="18" width="88" height="48" rx="2" fill="#dbeafe" stroke="#2563eb" strokeWidth="1.1" />
      <rect x="116" y="18" width="88" height="48" rx="2" fill="#dbeafe" stroke="#2563eb" strokeWidth="1.1" />
      <path d="M104 22 V62" stroke="#64748b" strokeWidth="1.2" strokeDasharray="3 2" />
      <path d="M104 42 H132" stroke="#db2777" strokeWidth="1.2" />
      <text x="110" y="86" textAnchor="middle" fill="#9d174d" fontSize="7">
        Setback, screening, or sill height
      </text>
    </Svg>
  );
}

function ParkingGraphic() {
  return (
    <Svg label="Car and bicycle parking">
      <rect x="20" y="18" width="70" height="42" rx="3" fill="#e2e8f0" stroke="#475569" strokeWidth="1.1" />
      <rect x="28" y="30" width="36" height="18" rx="2" fill="#94a3b8" />
      <circle cx="36" cy="52" r="4" fill="#334155" />
      <circle cx="56" cy="52" r="4" fill="#334155" />
      <circle cx="130" cy="40" r="14" fill="none" stroke="#0f766e" strokeWidth="2" />
      <circle cx="168" cy="40" r="14" fill="none" stroke="#0f766e" strokeWidth="2" />
      <text x="110" y="84" textAnchor="middle" fill="#334155" fontSize="7">
        Resident, visitor, bike, or accessible bays
      </text>
    </Svg>
  );
}

function MixGraphic() {
  return (
    <Svg label="Apartment type mix">
      <rect x="18" y="20" width="40" height="40" rx="2" fill="#ccfbf1" stroke="#0f766e" strokeWidth="1" />
      <rect x="66" y="14" width="48" height="46" rx="2" fill="#99f6e4" stroke="#0f766e" strokeWidth="1" />
      <rect x="122" y="10" width="56" height="50" rx="2" fill="#5eead4" stroke="#0f766e" strokeWidth="1" />
      <text x="38" y="44" textAnchor="middle" fill="#115e59" fontSize="7">
        1
      </text>
      <text x="90" y="42" textAnchor="middle" fill="#115e59" fontSize="7">
        2
      </text>
      <text x="150" y="40" textAnchor="middle" fill="#115e59" fontSize="7">
        3+
      </text>
      <text x="110" y="84" textAnchor="middle" fill="#115e59" fontSize="7">
        Mix, access, or accessible dwellings
      </text>
    </Svg>
  );
}

function KitchenGraphic() {
  return (
    <Svg label="Kitchen bench and clearance">
      <rect x="22" y="14" width="176" height="58" rx="3" fill="#f8fafc" stroke="#64748b" strokeWidth="1.1" />
      <rect x="30" y="22" width="100" height="20" rx="2" fill="#ffedd5" stroke="#ea580c" strokeWidth="1" />
      <text x="80" y="36" textAnchor="middle" fill="#9a3412" fontSize="8" fontWeight="600">
        Bench
      </text>
      <path d="M30 50 H130" stroke="#c2410c" strokeWidth="0.9" />
      <text x="80" y="62" textAnchor="middle" fill="#9a3412" fontSize="7">
        Clearance
      </text>
    </Svg>
  );
}

function GenericGraphic() {
  return (
    <Svg label="Design guideline">
      <rect x="30" y="16" width="160" height="50" rx="3" fill="#f1f5f9" stroke="#64748b" strokeWidth="1.1" />
      <text x="110" y="46" textAnchor="middle" fill="#334155" fontSize="8" fontWeight="600">
        Design guideline
      </text>
    </Svg>
  );
}

export function PolicyRuleGraphic({
  kind,
  rule,
}: {
  kind: PolicyGraphicKind;
  rule: PolicyRule;
}) {
  switch (kind) {
    case "apartment_size":
      return <AptSizeGraphic rule={rule} />;
    case "living":
      return <LivingGraphic rule={rule} />;
    case "pos":
      return <PosGraphic rule={rule} />;
    case "bedroom":
      return <BedroomGraphic rule={rule} />;
    case "bathroom":
      return <BathroomGraphic />;
    case "storage":
      return <StorageGraphic />;
    case "dual_aspect":
      return <DualAspectGraphic />;
    case "habitable_window":
      return <HabitableWindowGraphic />;
    case "communal":
      return <CommunalGraphic rule={rule} />;
    case "room_area":
      return <RoomAreaGraphic rule={rule} />;
    case "required_rooms":
      return <RequiredRoomsGraphic rule={rule} />;
    case "walls":
      return <WallsGraphic />;
    case "solar":
      return <SolarGraphic />;
    case "ventilation":
      return <VentilationGraphic />;
    case "circulation":
      return <CirculationGraphic />;
    case "acoustic":
      return <AcousticGraphic />;
    case "outlook":
      return <OutlookGraphic />;
    case "parking":
      return <ParkingGraphic />;
    case "mix":
      return <MixGraphic />;
    case "kitchen":
      return <KitchenGraphic />;
    default:
      return <GenericGraphic />;
  }
}

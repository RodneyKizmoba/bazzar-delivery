/**
 * Ilustrações próprias da PedeJá para as categorias da página inicial (desenhadas em código, sem direitos de terceiros).
 * Estilo: plano, colorido, com uma sombra suave por baixo, para os mosaicos ao estilo Deliveroo.
 */
const Shadow = () => <ellipse cx="32" cy="57" rx="19" ry="3" fill="#000" opacity=".1" />;

const ART: Record<string, () => JSX.Element> = {
  // prato angolano: frango grelhado, arroz e salada, a fumegar
  restaurant: () => (
    <>
      <Shadow />
      <ellipse cx="32" cy="44" rx="25" ry="10" fill="#fff" stroke="#E2E8F0" strokeWidth="1.5" />
      <ellipse cx="32" cy="43" rx="18" ry="6.5" fill="#F8FAFC" />
      <ellipse cx="24" cy="40" rx="9" ry="5" fill="#FFF7E0" stroke="#EBCB85" strokeWidth="1" />
      <g transform="rotate(-18 40 37)">
        <ellipse cx="40" cy="37" rx="9" ry="6" fill="#D9742F" />
        <ellipse cx="38" cy="35.5" rx="5" ry="2.4" fill="#F0A35E" opacity=".8" />
        <rect x="47" y="35.5" width="8" height="3" rx="1.5" fill="#FFF3E0" />
        <circle cx="55.5" cy="35.5" r="2" fill="#FFF3E0" /><circle cx="55.5" cy="39" r="2" fill="#FFF3E0" />
      </g>
      <ellipse cx="30" cy="45" rx="4.5" ry="2" fill="#5BBF3A" transform="rotate(-20 30 45)" />
      <circle cx="35" cy="46" r="2.2" fill="#EF4444" />
      <g fill="none" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round">
        <path d="M24 28c-3-4 3-6 0-10" /><path d="M32 26c-3-4 3-6 0-10" /><path d="M40 28c-3-4 3-6 0-10" />
      </g>
    </>
  ),
  // fatia de bolo com cobertura cor-de-rosa e cereja
  bakery: () => (
    <>
      <Shadow />
      <path d="M9 31 L22 40 L22 56 L9 47 Z" fill="#EFB679" />
      <path d="M22 40 L55 29 L55 45 L22 56 Z" fill="#FFE1B8" />
      <path d="M22 47 L55 36 L55 39 L22 50 Z" fill="#E5484D" />
      <path d="M9 38 L22 47 L22 50 L9 41 Z" fill="#C93A40" />
      <path d="M9 31 L42 20 L55 29 L22 40 Z" fill="#FF9EBB" />
      <path d="M22 40 L55 29 L55 32 Q50 36 46 33 Q41 38 36 35 Q30 40 26 38 Q24 42 22 43 Z" fill="#FF9EBB" />
      <path d="M38 21 q-1 -7 4 -10" stroke="#3F8F2F" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <circle cx="38" cy="22" r="4.6" fill="#D61F45" />
      <circle cx="36.6" cy="20.6" r="1.4" fill="#fff" opacity=".7" />
    </>
  ),
  // cesto de compras com baguete, maçã, cenoura e verdes
  grocery: () => (
    <>
      <Shadow />
      <rect x="31" y="9" width="7" height="27" rx="3.5" fill="#E7A24B" transform="rotate(18 34 22)" />
      <g stroke="#B97626" strokeWidth="1.3" strokeLinecap="round"><path d="M33 14l4 1" /><path d="M32 20l4 1" /><path d="M31 26l4 1" /></g>
      <ellipse cx="22" cy="24" rx="5" ry="9" fill="#4CB944" transform="rotate(-20 22 24)" />
      <ellipse cx="16" cy="27" rx="4" ry="8" fill="#2E9E3C" transform="rotate(-40 16 27)" />
      <path d="M44 20 L52 33 L42 31 Z" fill="#FF8A1F" />
      <path d="M44 20l-2-4M44 20l1-5M44 20l3-3" stroke="#3FA34D" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="28" cy="30" r="6" fill="#EF4444" /><path d="M28 24q2-4 5-3q-2 3-5 3" fill="#3FA34D" />
      <path d="M8 31 H56 L50 54 Q49 56 47 56 H17 Q15 56 14 54 Z" fill="#1FA97A" />
      <rect x="6" y="29" width="52" height="6" rx="3" fill="#15805C" />
      <g stroke="#7FE0B7" strokeWidth="1.6" opacity=".8"><path d="M20 38v15" /><path d="M28 38v15" /><path d="M36 38v15" /><path d="M44 38v15" /><path d="M12 44h40" /></g>
    </>
  ),
  // cápsula, comprimido e cruz verde
  pharmacy: () => (
    <>
      <Shadow />
      <g transform="rotate(-38 30 34)">
        <rect x="12" y="26" width="38" height="16" rx="8" fill="#fff" stroke="#E2E8F0" strokeWidth="1.2" />
        <path d="M31 26 H42 a8 8 0 0 1 0 16 H31 Z" fill="#FF4D6D" />
        <rect x="16" y="29" width="11" height="3" rx="1.5" fill="#E2E8F0" />
        <rect x="34" y="29" width="11" height="3" rx="1.5" fill="#fff" opacity=".45" />
      </g>
      <circle cx="47" cy="47" r="7" fill="#FFD54F" /><path d="M42 47 h10" stroke="#E0A800" strokeWidth="1.6" />
      <rect x="10" y="40" width="16" height="16" rx="4" fill="#22B573" />
      <path d="M18 43.5v9M13.5 48h9" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  // batom e espelho compacto com brilho
  beauty: () => (
    <>
      <Shadow />
      <circle cx="42" cy="38" r="14" fill="#C084FC" />
      <circle cx="42" cy="38" r="10.5" fill="#E9D5FF" />
      <path d="M36 33 l5 -3" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="14" y="34" width="13" height="22" rx="2.5" fill="#F2C14E" />
      <rect x="14" y="34" width="13" height="4" rx="1.5" fill="#D9A21B" />
      <path d="M16 34 V22 Q16 15 25 12 V34 Z" fill="#E11D63" />
      <path d="M18.5 32 V23" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
      <path d="M52 14 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5 z" fill="#FFD54F" />
    </>
  ),
  // Desapega (moda nova, vintage e segunda mão): casaco num cabide, com etiqueta de preço
  vintage: () => (
    <>
      <Shadow />
      <path d="M32 7 q4 0 4 4 q0 3 -4 4 v3" stroke="#6B7280" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M32 18 L10 28 H54 Z" fill="none" stroke="#6B7280" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M20 26 L32 22 L44 26 L50 31 L46 37 L43 35 V56 H21 V35 L18 37 L14 31 Z" fill="#C2410C" />
      <path d="M27 23.5 L32 33 L37 23.5" fill="#FDE6D3" />
      <path d="M32 33 V56" stroke="#9A3412" strokeWidth="1.6" />
      <circle cx="34.5" cy="39" r="1.3" fill="#FCD34D" /><circle cx="34.5" cy="45" r="1.3" fill="#FCD34D" /><circle cx="34.5" cy="51" r="1.3" fill="#FCD34D" />
      <path d="M23 44 h6 v4 h-6 z" fill="#9A3412" />
      <path d="M46 40 l8 -2 2 7 -8 2 z" fill="#FFF7ED" stroke="#9A3412" strokeWidth="1.2" />
      <circle cx="48" cy="41.5" r="0.9" fill="#9A3412" />
      <path d="M43 36 l3.5 4" stroke="#9A3412" strokeWidth="1" />
    </>
  ),
  // bijuteria: colar de pérolas com pendente e um anel
  jewelry: () => (
    <>
      <Shadow />
      <path d="M14 14 Q32 46 50 14" fill="none" stroke="#D4A017" strokeWidth="1.4" />
      {[[16,19],[19,25],[22.5,30],[26.5,34],[32,36],[37.5,34],[41.5,30],[45,25],[48,19]].map(([x,y],i) => <circle key={i} cx={x} cy={y} r="2.4" fill="#FFF7E6" stroke="#E5C77A" strokeWidth=".8" />)}
      <path d="M32 38 l5 6 -5 7 -5 -7 z" fill="#E11D63" stroke="#9D174D" strokeWidth="1" />
      <path d="M32 38 l2 6 -2 7" fill="#F472B6" opacity=".7" />
      <circle cx="49" cy="46" r="6" fill="none" stroke="#F2C14E" strokeWidth="2.6" />
      <path d="M46.5 39.5 l2.5 -3 2.5 3 -2.5 1.5 z" fill="#7DD3FC" stroke="#0EA5E9" strokeWidth=".8" />
      <path d="M12 44 l1.2 2.8 2.8 1.2 -2.8 1.2 -1.2 2.8 -1.2 -2.8 -2.8 -1.2 2.8 -1.2 z" fill="#FFD54F" />
    </>
  ),
  // outros negócios: pequena loja com toldo
  other: () => (
    <>
      <Shadow />
      <rect x="12" y="26" width="40" height="30" rx="2" fill="#2563EB" />
      <rect x="16" y="34" width="14" height="12" rx="1.5" fill="#DBEAFE" />
      <rect x="35" y="34" width="12" height="22" rx="1.5" fill="#1E3A8A" />
      <circle cx="44" cy="45" r="1" fill="#FCD34D" />
      <path d="M9 18 H55 L52 28 H12 Z" fill="#fff" />
      {[0,1,2,3,4].map((i) => <path key={i} d={`M${9+i*9.2} 18 h4.6 l-0.6 10 h-4.6 z`} fill="#EF4444" />)}
      <path d="M10 28 q2.6 3 5.3 0 q2.6 3 5.3 0 q2.6 3 5.3 0 q2.6 3 5.3 0 q2.6 3 5.3 0 q2.6 3 5.3 0 q2.6 3 5.3 0 q2.6 3 5.3 0" fill="#EF4444" />
      <rect x="22" y="9" width="20" height="7" rx="2" fill="#FCD34D" />
    </>
  ),
  // ramo de túlipas em papel kraft
  flowers: () => (
    <>
      <Shadow />
      <path d="M32 50 L22 20" stroke="#3FA34D" strokeWidth="2.2" /><path d="M32 50 L32 16" stroke="#3FA34D" strokeWidth="2.2" /><path d="M32 50 L43 20" stroke="#3FA34D" strokeWidth="2.2" />
      <ellipse cx="25" cy="33" rx="3" ry="7" fill="#4CB944" transform="rotate(-30 25 33)" />
      <ellipse cx="39" cy="33" rx="3" ry="7" fill="#4CB944" transform="rotate(30 39 33)" />
      <path d="M17 13 q5 -6 10 0 l-1 8 q-4 3 -8 0 z" fill="#FF5C8A" /><path d="M22 9 l2 6 2 -6" fill="#FF8FB1" />
      <path d="M27 9 q5 -6 10 0 l-1 8 q-4 3 -8 0 z" fill="#FFC23D" />
      <path d="M38 13 q5 -6 10 0 l-1 8 q-4 3 -8 0 z" fill="#B15CFF" />
      <path d="M17 32 H47 L36 57 H28 Z" fill="#D9A066" />
      <path d="M17 32 H47 L44 38 H20 Z" fill="#C88A4E" />
      <path d="M28 44 q4 -3 8 0 q-4 3 -8 0 z M32 44 l-3 6 M32 44 l3 6" fill="#E11D63" stroke="#E11D63" strokeWidth="1.5" />
    </>
  ),
  // caixa de presente com laço
  retail: () => (
    <>
      <Shadow />
      <rect x="13" y="30" width="38" height="25" rx="3" fill="#7B1FFF" />
      <rect x="10" y="23" width="44" height="10" rx="3" fill="#9B5CFF" />
      <rect x="28" y="23" width="8" height="32" fill="#FFD54F" />
      <path d="M32 23 q-14 -14 -16 -4 q0 6 16 4 z" fill="#FFD54F" stroke="#E0A800" strokeWidth="1.2" />
      <path d="M32 23 q14 -14 16 -4 q0 6 -16 4 z" fill="#FFD54F" stroke="#E0A800" strokeWidth="1.2" />
      <circle cx="32" cy="22.5" r="3" fill="#E0A800" />
      <rect x="15" y="34" width="4" height="16" rx="2" fill="#fff" opacity=".2" />
    </>
  ),
  // hambúrguer
  burger: () => (
    <>
      <Shadow />
      <path d="M10 30 C10 10 54 10 54 30 Z" fill="#F4A340" />
      <g fill="#FFF3D6"><ellipse cx="24" cy="19" rx="2" ry="1.1" /><ellipse cx="32" cy="16" rx="2" ry="1.1" /><ellipse cx="40" cy="19" rx="2" ry="1.1" /><ellipse cx="29" cy="24" rx="2" ry="1.1" /><ellipse cx="37" cy="24" rx="2" ry="1.1" /></g>
      <path d="M8 31 q4 5 8 0 q4 5 8 0 q4 5 8 0 q4 5 8 0 q4 5 8 0 q4 5 8 0 v3 H8 Z" fill="#6CCB3A" />
      <path d="M10 34 H54 L49 40 L44 34 Z" fill="#FFD23F" />
      <rect x="9" y="36" width="46" height="8" rx="4" fill="#6B3A22" />
      <rect x="11" y="44" width="42" height="3" rx="1.5" fill="#EF4444" />
      <path d="M11 47 H53 Q53 55 45 55 H19 Q11 55 11 47 Z" fill="#F4A340" />
    </>
  ),
  // fatia de piza
  pizza: () => (
    <>
      <Shadow />
      <path d="M32 56 L10 16 Q32 6 54 16 Z" fill="#FFD45C" />
      <path d="M10 16 Q32 6 54 16 L52 20 Q32 11 12 20 Z" fill="#E59A3C" />
      <path d="M10 16 Q32 6 54 16" stroke="#C97B26" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <g fill="#E23B3B"><circle cx="25" cy="25" r="4.5" /><circle cx="38" cy="26" r="4.5" /><circle cx="31" cy="38" r="4" /></g>
      <g fill="#3FA34D"><ellipse cx="31" cy="21" rx="3" ry="1.6" transform="rotate(25 31 21)" /><ellipse cx="36" cy="34" rx="3" ry="1.6" transform="rotate(-25 36 34)" /></g>
      <path d="M22 31 q-1 5 1 7" stroke="#FFD45C" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  // espetada na brasa
  grill: () => (
    <>
      <Shadow />
      <path d="M18 54 q-4 -8 2 -12 q0 6 4 6 q-2 -9 5 -13 q-1 9 5 10 q0 -6 4 -8 q3 8 -2 17 Z" fill="#FF8A1F" />
      <path d="M24 54 q-2 -5 2 -8 q1 4 3 4 q0 -5 3 -7 q2 5 -1 11 Z" fill="#FFD23F" />
      <path d="M8 40 L58 16" stroke="#8A6A4A" strokeWidth="2.4" strokeLinecap="round" />
      <g transform="rotate(-25.6 33 28)">
        <rect x="11" y="22" width="9" height="11" rx="2.5" fill="#8B3A1E" />
        <rect x="21" y="22" width="7" height="11" rx="2" fill="#E5484D" />
        <rect x="29" y="22" width="9" height="11" rx="2.5" fill="#9C4422" />
        <rect x="39" y="22" width="6" height="11" rx="2" fill="#5BBF3A" />
        <rect x="46" y="22" width="9" height="11" rx="2.5" fill="#8B3A1E" />
        <g stroke="#3B1A0C" strokeWidth="1.3" opacity=".6"><path d="M13 25l5 5" /><path d="M31 25l5 5" /><path d="M48 25l5 5" /></g>
      </g>
    </>
  ),
  // sushi: maki de salmão e pauzinhos
  sushi: () => (
    <>
      <Shadow />
      <rect x="6" y="49" width="52" height="6" rx="3" fill="#2E3333" />
      <circle cx="22" cy="36" r="12" fill="#1F2A2A" /><circle cx="22" cy="36" r="9" fill="#fff" /><circle cx="22" cy="36" r="4.5" fill="#FF7B54" /><circle cx="24" cy="37.5" r="1.8" fill="#6CCB3A" />
      <circle cx="44" cy="38" r="10" fill="#1F2A2A" /><circle cx="44" cy="38" r="7.5" fill="#fff" /><circle cx="44" cy="38" r="3.8" fill="#FFB020" />
      <path d="M8 18 L56 10" stroke="#C88A4E" strokeWidth="2.6" strokeLinecap="round" /><path d="M8 23 L56 16" stroke="#B97626" strokeWidth="2.6" strokeLinecap="round" />
    </>
  ),
  // panela de barro com muamba
  angolan: () => (
    <>
      <Shadow />
      <g fill="none" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round"><path d="M24 20c-3-4 3-6 0-10" /><path d="M32 18c-3-4 3-6 0-10" /><path d="M40 20c-3-4 3-6 0-10" /></g>
      <ellipse cx="32" cy="29" rx="23" ry="6" fill="#B8541F" />
      <ellipse cx="32" cy="29" rx="19" ry="4.2" fill="#F07F1A" />
      <circle cx="25" cy="28.5" r="2.4" fill="#C2410C" /><circle cx="36" cy="29.5" r="2" fill="#5BBF3A" /><circle cx="40" cy="28" r="2.4" fill="#C2410C" />
      <path d="M9 29 Q10 56 32 56 Q54 56 55 29 Q50 35 32 35 Q14 35 9 29 Z" fill="#C8642A" />
      <path d="M13 40 Q32 47 51 40" stroke="#FFD54F" strokeWidth="2" fill="none" />
      <path d="M15 46 Q32 52 49 46" stroke="#8B3A1E" strokeWidth="1.6" fill="none" strokeDasharray="3 3" />
      <path d="M7 31 h-3 M57 31 h3" stroke="#8B3A1E" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  // encomenda: caixa de cartão com seta de envio
  parcel: () => (
    <>
      <Shadow />
      <path d="M10 24 L32 14 L54 24 L32 34 Z" fill="#F2C38A" />
      <path d="M10 24 L32 34 L32 56 L10 46 Z" fill="#D99A55" />
      <path d="M54 24 L32 34 L32 56 L54 46 Z" fill="#E8AE6B" />
      <path d="M21 19 L43 29 L43 37 L39 35 L39 31 L17 21 Z" fill="#FFF3D6" opacity=".9" />
      <path d="M36 44 h12 m-4 -4 l4 4 -4 4" stroke="#7B1FFF" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 34 l6 3 M14 38 l6 3" stroke="#B9732E" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  // táxi: carro amarelo com placa no tejadilho
  taxi: () => (
    <>
      <Shadow />
      <rect x="25" y="14" width="14" height="6" rx="2" fill="#2E3333" />
      <text x="32" y="19" textAnchor="middle" fontSize="4.6" fontWeight="800" fill="#FFD23F" fontFamily="system-ui, sans-serif">TAXI</text>
      <path d="M14 32 L19 22 Q20 20 23 20 H41 Q44 20 45 22 L50 32 Z" fill="#FFC107" />
      <path d="M20 31 L23.5 23.5 H31 V31 Z M33 31 V23.5 H40.5 L44 31 Z" fill="#BFE6FF" />
      <rect x="8" y="30" width="48" height="15" rx="6" fill="#FFC107" />
      <rect x="8" y="36" width="48" height="4" fill="#2E3333" opacity=".85" />
      <g fill="#FFF8E1"><rect x="8" y="36" width="4" height="4" /><rect x="16" y="36" width="4" height="4" /><rect x="24" y="36" width="4" height="4" /><rect x="32" y="36" width="4" height="4" /><rect x="40" y="36" width="4" height="4" /><rect x="48" y="36" width="4" height="4" /></g>
      <circle cx="11.5" cy="33" r="2" fill="#FFF3B0" /><circle cx="52.5" cy="33" r="2" fill="#FF5252" />
      <circle cx="19" cy="46" r="6" fill="#2E3333" /><circle cx="19" cy="46" r="2.6" fill="#CBD5E1" />
      <circle cx="45" cy="46" r="6" fill="#2E3333" /><circle cx="45" cy="46" r="2.6" fill="#CBD5E1" />
    </>
  ),
};

export const CATEGORY_TILE_BG: Record<string, string> = {
  restaurant: "#FFE7D6", bakery: "#FFF1C9", grocery: "#DDF6E6", pharmacy: "#DCF2F5", beauty: "#F6E3FF",
  flowers: "#FFE3EC", retail: "#ECE5FF", vintage: "#FBE7DA", jewelry: "#FFF4CC", other: "#E3EEFF", burger: "#FFF0D1", pizza: "#FFE4DC", grill: "#FFE7D6",
  sushi: "#E2EEFF", angolan: "#FFE9D2", parcel: "#EFE6FF", taxi: "#FFF6CC",
};

export function CategoryArt({ kind, className }: { kind: string; className?: string }) {
  const Draw = ART[kind];
  if (!Draw) return null;
  return <svg viewBox="0 0 64 64" className={className} aria-hidden><Draw /></svg>;
}

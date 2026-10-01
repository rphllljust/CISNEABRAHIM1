import { ChartNoAxesColumn, Layers, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

/** Fotografia institucional da área esquerda — ver public/images/auth/README.md. */
const HERO_PHOTO_SRC = '/images/auth/login-cisne.webp';

const INSTITUTIONAL_TAGS = ['Operação', 'Gestão', 'Resultados', 'Sempre à frente'];

const BENEFITS = [
  { key: 'produtividade', Icon: ChartNoAxesColumn, lead: 'Mais', value: 'produtividade' },
  { key: 'controle', Icon: ShieldCheck, lead: 'Mais', value: 'controle' },
  { key: 'resultados', Icon: Layers, lead: 'Mais', value: 'resultados' },
];

/**
 * Área esquerda do login: fotografia cinematográfica de operação pesada em
 * Rondônia com o conteúdo institucional em HTML real por cima.
 *
 * A fotografia é apenas cenário — nenhum texto, marca ou controle da interface
 * vive no arquivo. Todo o conteúdo é HTML real renderizado por cima.
 *
 * Enquanto `public/images/auth/login-cisne.webp` não existir, o `onError`
 * descarta o `<img>` e a camada de fallback em CSS sustenta a composição, sem
 * ícone de imagem quebrada e sem deslocamento de layout. Assim que o arquivo
 * for entregue, a fotografia assume o lugar do fallback automaticamente.
 */
export function LoginHero() {
  const [photoFailed, setPhotoFailed] = useState(false);

  return (
    <aside className="login-hero" aria-label="Identidade institucional">
      <div className="login-hero__backdrop" aria-hidden="true" />

      {photoFailed ? null : (
        <img
          className="login-hero__photo"
          src={HERO_PHOTO_SRC}
          alt=""
          decoding="async"
          fetchPriority="high"
          onError={() => setPhotoFailed(true)}
        />
      )}

      <div className="login-hero__scrim" aria-hidden="true" />

      <div className="login-hero__top">
        <div className="login-hero__tags">
          <span className="login-hero__tags-rule" aria-hidden="true" />
          <p className="login-hero__tags-list">
            {INSTITUTIONAL_TAGS.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </p>
        </div>

        <div className="login-hero__place">
          <p className="login-hero__place-list">
            <span>Porto Velho</span>
            <span>Rondônia</span>
          </p>
          <span className="login-hero__place-rule" aria-hidden="true" />
        </div>
      </div>

      <div className="login-hero__bottom">
        <h1 className="login-hero__headline">
          Sua empresa
          <br />
          mais eficiente
        </h1>

        <p className="login-hero__description">
          Gestão completa em uma única plataforma. Locação, serviços, frotas, pessoas, finanças,
          fiscal, contabilidade e muito mais.
        </p>

        <ul className="login-hero__benefits">
          {BENEFITS.map(({ key, Icon, lead, value }) => (
            <li key={key} className="login-hero__benefit">
              <Icon className="login-hero__benefit-icon" aria-hidden="true" />
              <span className="login-hero__benefit-text">
                {lead}
                <br />
                {value}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

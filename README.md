# ✈️ AIR RAIDERS // Remastered Cockpit Edition

![Atari 2600](https://img.shields.io/badge/Atari_2600-1982_M_Network-ffae00?style=for-the-badge)
![Reverse Engineering](https://img.shields.io/badge/6502_ROM-AIRAIDRS.BIN_(4KB)-00f0ff?style=for-the-badge)
![Tech](https://img.shields.io/badge/HTML5_Canvas-Web_Audio_API-00ff88?style=for-the-badge)

Uma recriação moderna para navegador (HTML5 Canvas + Web Audio API) do clássico jogo de combate aéreo em primeira pessoa **Air Raiders**, lançado originalmente em **1982** pela **M Network (Mattel Electronics)** para o **Atari 2600** e programado por **Larry Zwick**.

Este projeto nasceu da **engenharia reversa direta do binário original (`AIRAIDRS.BIN`, 4096 bytes)**, preservando todas as regras táticas, equações de voo, gerenciamento de recursos e mecânicas de pouso/decolagem do código 6502 original, mas com gráficos vetoriais/3D modernos e áudio procedural sintetizado em tempo real.

---

## 🎮 Como Jogar

Não há dependências externas nem necessidade de build.

1. Clone este repositório:
   ```bash
   git clone https://github.com/realzurr/air_Raiders.git
   ```
2. Abra o arquivo `index.html` diretamente em qualquer navegador moderno (Chrome, Edge, Firefox, Safari) ou utilize um servidor local simples:
   ```bash
   npx serve .
   # ou
   python -m http.server 8080
   ```

---

## 🕹️ Controles

| Ação | Teclado | Mouse | Equivalente no Atari 2600 |
| :--- | :---: | :---: | :--- |
| **Mergulhar (Dive) / Alinhar Pouso** | `W` ou `Seta para Cima ↑` | — | Empurrar Joystick para Frente |
| **Subir (Climb) / Decolar** | `S` ou `Seta para Baixo ↓` | — | Puxar Joystick para Trás |
| **Inclinar à Esquerda (Bank Left)** | `A` ou `Seta Esquerda ←` | — | Joystick para a Esquerda |
| **Inclinar à Direita (Bank Right)** | `D` ou `Seta Direita →` | — | Joystick para a Direita |
| **Canhão Vulcan / Acelerar na Pista** | `Espaço`, `Enter` ou `K` | `Clique Esquerdo` | Botão de Fogo (Fire) |

---

## 📜 As Regras Oficiais do Jogo (Fidelidade à ROM)

Diferente de outros jogos de tiro do Atari 2600, **Air Raiders** exige gerenciamento rigoroso de combustível, munição e altitude:

### 1. Decolagem (`ALT 00`)
- Você começa parado na pista (`$E3 = $40`).
- Pressione **Espaço** (ou clique) para acionar a pós-combustão e acelerar pela pista.
- Assim que o computador de voo indicar **Velocidade de Rotação** (~3 segundos), puxe o manche (`S` ou `↓`) para levantar voo. Se chegar ao fim da pista sem puxar o manche, o avião sofre um acidente!

### 2. Combate Aéreo, Altitude e Consumo de Combustível
- **Altímetro (`00` a `40`):** Representa sua altitude de `0` até **40.000 pés**.
- **Consumo de Combustível (`FUEL`):** Inicia com `27` unidades (`$1B`). O combustível drena continuamente, mas **subir ou voar em grandes altitudes dobra a taxa de consumo**. Se o combustível zerar em pleno voo, a aeronave perde empuxo e mergulha até o solo.
- **Zona Vermelha de Flak (Artilharia Antiaérea):** Na barra horizontal inferior do painel, a **faixa central vermelha** indica espaço aéreo fortemente defendido por canhões antiaéreos. Explosões pretas de *Flak* próximas à sua mira sacodem o caça e forçam um mergulho repentino. Suba para grandes altitudes ou incline para sair da zona vermelha!

### 3. A Regra dos 10 Abates e Pouso para Reabastecimento
Você **não pode pousar a qualquer momento**:
1. **Meta Obrigatória:** É necessário abater **pelo menos 10 caças inimigos na sortida atual** para receber autorização de reabastecimento.
2. **Aproximação:** Com 10 ou mais abates na sortida, desça suavemente até `ALT 00` e mantenha voo nivelado por alguns segundos até que a pista de pouso apareça no horizonte.
3. **Toque no Solo (Touchdown):** Quando a pista surgir, empurre o manche para frente (`W` ou `↑`) para alinhar o nariz com a pista e solte o manche para pousar.
4. **Recompensa de Munição:** Ao pousar com sucesso, seu tanque de combustível é completado e **sua nova quantidade de munição (`AMMO`) será exatamente igual ao número de abates conquistados naquela sortida**! Se pousar com menos de 10 abates, a missão é encerrada.

---

## 🏅 Classificação de Piloto (Pilot Ratings)

Ao final da missão, seu desempenho é avaliado conforme a tabela oficial do manual de 1982:

| Total de Abates (Hits) | Patente (Rating) |
| :---: | :--- |
| **0 – 9** | Student Pilot *(Cadete)* |
| **10 – 24** | Novice Pilot *(Piloto Novato)* |
| **25 – 39** | Fighter Pilot *(Piloto de Caça)* |
| **40 – 64** | Ace Pilot *(Ás da Aviação)* |
| **65 – 89** | Double Ace *(Duplo Ás)* |
| **90+** | Triple Ace *(Triplo Ás Supremo)* |

---

## 🔧 Detalhes Técnicos da Engenharia Reversa (`AIRAIDRS.BIN`)

A arquitetura lógica em `game.js` reproduz os algoritmos originais desmontados do código 6502 (`$F000–$FFFF`):

- **Inicialização de Registradores (`$F066–$F096`):** Carrega os mesmos parâmetros iniciais da RAM do Atari 2600: Combustível `$DC = $1B` (27), Munição `$DF = $99` (BCD), Pitch central `$DA = $16` (22), Posição X `$E7:$E6 = $01C0` e Estado de Pista `$E3 = $40`.
- **Física de Arfagem e Rolagem (`$F15A–$F230`):** O ângulo de Pitch (`$DA`, variando de `$01` a `$2C`) e o Roll (`$D9`, 5 estados de `-2` a `+2` mapeados na tabela `$F1F6`) retornam automaticamente ao centro quando o jogador solta o controle.
- **Conversão de Altímetro (`$F2F6–$F315`):** A altitude interna (`$E5`, `0..255`) é convertida para milhares de pés (`$D7`, `00..40`) usando a exata operação bit-a-bit da ROM: `(((E5 >> 2) + 2 + E5) >> 3)`.
- **Validação BCD de Pouso (`$F285–$F2A0`):** Verifica `hitsDB - prevLandingHitsE1 >= 10` (`CMP #$0A`) para recarregar `$DC = $1B` e definir `$DF` com o saldo da sortida.
- **Sintetizador de Áudio (`$FEBA–$FF20`):** As três sequências sonoras da tabela `$FED7` da ROM (Canhão Vulcan em `$FED8`, Explosão de Caça em `$FEFA` e Explosão de Flak em `$FF14`), além do som contínuo de turbina modulada pelo pitch (`$F38F–$F3EA`), foram recriados com osciladores, filtros passa-banda/passa-baixa e geradores de ruído da **Web Audio API**.

---

## 📂 Estrutura do Projeto

```text
├── AIRAIDRS.BIN   # Binário original de 4 KB do Atari 2600 (1982)
├── index.html     # Interface do cockpit, modais de briefing, manual e créditos
├── style.css      # Estilização tática cyberpunk/aviação e layout responsivo
├── game.js        # Motor 3D em Canvas, física 6502 e sintetizador Web Audio API
└── README.md      # Documentação do repositório
```

---

## 👨‍💻 Créditos

### Jogo Original (1982)
- **Título:** *Air Raiders* (Atari 2600 / VCS — Catálogo `#MT5661`)
- **Design & Programação 6502:** Larry Zwick
- **Publicação:** M Network (Mattel Electronics)

### Versão Remaster & Engenharia Reversa
- **Desenvolvimento, Engenharia Reversa & Remaster Web:** [@realzurr](https://github.com/realzurr)

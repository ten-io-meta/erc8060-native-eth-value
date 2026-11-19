# Auditoría cruzada ERC-8060 / ERC-8098 / Reservable / OECL
**Corte de revisión:** 19 noviembre 2026. **Alcance:** revisión técnica de fuentes y evidencia CI ya publicada. NO es una auditoría independiente integral, una prueba formal de ausencia de fallos, ni permiso para desplegar ETH real. No se modifica ningún contrato ni despliegue.

## Fuentes inspeccionadas
- ERC-8098: ethereum/ERCs PR #1390, abierto y en Draft. Fuente exacta en ten-io-meta/ERCs, rama patch-1, archivo erc-8098.md, SHA de blob 02fb753d4f1630d8fbfa4e98d712aefea4434a9f. Es un PERFIL DE COMPORTAMIENTO ERC-20; no introduce nueva ABI ni puede impedir wrappers externos.
- ERC-8060 borrador: ten-io-meta/ERCs, ERCS/erc-8060.md, blob fade0fd4ca0a0926a618e13f2b884f520ae9912e. Núcleo: valueOf(uint256) y burn(uint256); ERC-165 estricto 0x88495fe7.
- Referencia ERC-8060 con propietario: PR #1 de ten-io-meta/erc8060-native-eth-value, archivo contracts/ERC8060Reference.sol, blob f15996bb233bb75a6afb8eb9053c0f7be3315c50; SHA PR 197db3d6f63aa258ec0a6fbc1ebbd16f60b31a66. GitHub Actions 44196026326: 52/52 pruebas Hardhat PASS.
- Referencia estricta sin administrador: PR #16 de ten-io-meta/erc8060-reservable, contracts/reference/ERC8060NativeETHReference.sol, blob ed93915b424bad79d97c473908638ecca600c567. No contiene Ownable, retirada privilegiada ni setter administrador; acuñación libre, totalmente financiada con ETH, SIN límite finito de emisión.
- Condicional Reservable: contracts/reference/ReservableConditionalETHReference.sol, blob cc8c106d92c972bc372ee98ceb9602a2e491f3eb, y contracts/IERC8060Reservable.sol. Contabilidad condicional: no se anuncia como strict ERC-8060, ni sus locks por sí mismos son cobros ejecutables.
- Prueba de procedencia adversarial: docs/review/oecl_forged_provenance_v6.md, blob c80a4eab5dac1a1bd0ee4db224e3b9851a47d59d; PR #16 a SHA 8be07aadf1316f3cac38522ae58f73bfdf1ba3f3: 69/69 Foundry y 213/213 Hardhat. ATENCIÓN: algunos tests PASS reproducen contraejemplos de inseguridad, no los solucionan.
- Despliegue histórico: TENIO-Fragment/contracts/TENIOFragment.sol, blob 027541c22e718fcfdf2e02d6c3245505ca5063a9, y revisión PR #3 en TENIO-Fragment. Quema sin pago si no hay ETH y administrador puede retirar todo el balance; prefijo de instrucciones ejecutables reproduce los despliegues, NO los 53 bytes de metadatos Solidity.
- OECL original: open-erc-composition-laboratory/sources/manifest.json, blob 19538ef78a2b413c1a844baef31c24c0b57f060c. Las dos fuentes Reservable figuran con enabled: false y no se ingieren en el flujo principal. CI original compila TS y ejecuta experimento positivo; NO valida automáticamente las PR #10-16 recientes.

## Hallazgos por prioridad

| ID | Riesgo / incompatibilidad | Estado y acción |
|---|---|---|
| A01 | El ERC8060Reference de PR #1 mantiene Ownable y withdrawSurplus. | Verificado en fuente. Retirada limitada al excedente, NO al respaldo; pero no cumple el objetivo de CERO roles privilegiados. No afirmar «nadie tiene llaves» para esta variante. |
| A02 | La referencia estricta sin owner permite acuñar NFT sin límite de suministro a cambio de ETH. | Verificado. No compromete por sí solo la garantía de valor, pero NO constituye escasez finita ni adopta ERC-8098. Añadir cap inmutable solo si se quiere una colección de emisión finita. |
| A03 | ERC-8098 no tiene implementación Solidity de referencia ni suite CI propia identificadas en los doce repositorios visibles. | Brecha de cobertura. El texto de norma por sí solo NO acredita código ERC-20 sin remint. Construir referencia aislada solo si existe caso de uso fungible. |
| A04 | Reservable expone locks de contabilidad; releaseValue permite al propio controller liberar su porción. | Verificado. Una reserva no prueba deuda cobrada ni impide cancelación unilateral del compromiso por un controller con facultad; los derechos y plazos deben estar ejecutados en la APP autenticada. |
| A05 | Proveniencia falsa: igual runtime codehash con almacenamiento constructor y fábrica manipulados. | Contraejemplo reproducido en PR #16. ERC-165, lockedBy, isSolvent y codehash no validan por sí solos el origen, los depósitos ni la ejecución. Se necesita procedencia verificada por cadena y creación. |
| A06 | ERC8060MarketplaceLab: buyNaive deliberadamente vulnerable; buyStrict confía en ERC165 y valueOf autodeclarados; buyConditionalLab emplea valueOf que NO pertenece al ABI Reservable general. | Código de laboratorio, NO integración genérica apta para fondos reales. |
| A07 | OECL original todavía NO ingiere automáticamente las nuevas evidencias Reservable. | Fuente de manifiesto desactivada y CI parcial. Integración OECL versión-bloque-commit fijada pendiente. |
| A08 | TENIO Fragment histórico puede quemar sin pago y withdraw extraer respaldo. | Riesgo verificado en instrucciones EVM reproducidas localmente; los despliegues históricos NO deben anunciarse conformes con ERC-8060 estricto. |
| A09 | Redención a msg.sender: smart wallets con receive que rechaza ETH conservan su NFT por revert pero pueden sufrir problemas de salida. | Riesgo de liveness. Una extensión burnTo opcional podría investigarse SIN tocar el núcleo de dos funciones. |
| A10 | mint en PR #1 usa _safeMint que llama un ERC721Receiver externo; mint no tiene nonReentrant. | Superficie de reentrada potencial, no exploit demostrado. Añadir pruebas de callback que llamen mint, burn, transfer y withdrawSurplus. |
| A11 | supply no creciente no equivale a ETH solvente, ni evita wrappers arbitrarios de terceros. | Distinción normativa esencial para ERC-8098+ERC-8060. No afirmar garantía global sobre terceros. |

## Invariantes aceptables, medibles

**ERC-8060 estricto:**
- En todo estado alcanzable, saldo ETH del custodio >= deuda de ETH de todos los NFT vivos.
- La deuda se corresponde con la suma independiente del valor recuperable individual; un testigo de almacenamiento no debe verificarse a sí mismo.
- Una quema AUTORIZADA exitosa destruye el NFT y transfiere exactamente el valor correspondiente; ante cualquier error se revierten propiedad, contabilidad y transferencia.
- Ningún admin, módulo externo ni actualización puede quitar ETH comprometido sin respetar la deuda.
- El identificador ERC-165 estricto es una declaración de interfaz, NUNCA certificación económica.

**ERC-8098 SOLO en su ERC-20:**
- Para cada transición posterior al despliegue, supply_next <= supply_previous. Una transferencia no necesita disminuir supply.
- Cada quema retira unidades definitivamente; sin funciones mint, remint, update, delegatecall, roles o upgrades que reactiven emisión.
- Un estado canónico de saldos y supply ERC-20; no contabilidad interna que duplique unidades.
- Wrappers y derivados de TERCEROS quedan fuera del ámbito normativo del ERC actual.

**Escasez análoga para colección ERC-721 (inspirada, NO conformidad ERC-8098):**
- MAX_MINTED inmutable, mintedTotal <= MAX_MINTED, identificadores jamás reciclados.
- Cierre irreversible de emisión; desde ese punto NFT_vivos(t+1) <= NFT_vivos(t).
- No hay una llave de administrador que vuelva a abrir emisión ni que vacíe respaldo.

**Reservable y OECL:**
- Por NFT: backing = disponible + bloqueado; por controlador: porciones exclusivas y autorizaciones separadas.
- Un lock por sí solo NO otorga derecho a cobro: comprobar custodia, financiación real, beneficiario, vencimiento y transacción atómica.
- Verificar factory/deploy/constructor input antes de aceptar valores declarados. Si falta procedencia: UNKNOWN/REJECT, no ACCEPT.
- La evidencia OECL es una instantánea sujeta a caducidad de estado, no un permiso permanente.

## Decisiones de diseño recomendadas

1. Mantener IERC721Value de dos funciones. NO añadir ERC-8098 al núcleo 8060 por marketing.
2. Elegir como referencia canónica final una implementación estricta sin Ownable, sin proxy, sin upgrade y sin retiradas administrativas de respaldo.
3. Decidir explícitamente si el producto ofrece mint ilimitado completamente financiado, o un máximo rígido con cierre automático/irreversible de emisión.
4. Publicar una implementación ERC-8098 ERC-20 separada si realmente necesita existir un token fungible irreversible.
5. Consolidar y revisar PR #10–16 de Reservable y evaluar OECL con entradas reales y procedencia autenticada, no solo tests internos que pueden confirmar vulnerabilidades conocidas.
6. Requerir auditoría de terceros, fuzzing stateful con libro sombra, pruebas de fallos de cobro, análisis estático y revisión de toda autoridad antes de mover fondos reales.

## Límites
Esta es una **auditoría acotada de invariantes, referencias y amenazas identificadas**, no una inspección línea a línea de todos los contratos Solidity existentes en todos los repositorios ni prueba de ausencia de fallos. Ningún main está modificado, ninguna PR fusionada y ningún contrato real actualizado.

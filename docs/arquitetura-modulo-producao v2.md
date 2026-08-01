# Arquitetura do módulo de produção — Lemoov Admin (v2)

> **Status:** arquitetura oficial escolhida para implementação, incluindo importação de XML de NF-e no MVP.

## 1. Objetivo

Adicionar ao admin um módulo capaz de responder, com rastreabilidade:

- o que será e o que foi produzido;
- quais insumos cada peça consome;
- por quais setores a peça deve passar e já passou;
- quanto foi gasto com material e mão de obra;
- qual é o custo previsto e o custo realizado por peça;
- qual é a produtividade por período, ordem, setor e colaborador/equipe;
- quanto existe de matéria-prima, produto em processo (WIP) e produto acabado.

O módulo deve aproveitar o catálogo de produtos acabados e integrar a conclusão da produção ao estoque já existente.

### Separação entre venda e produção

O cadastro atual de **Produtos** não receberá campos de preço ou compra de insumos. São contextos diferentes:

- **Produtos:** produto acabado, fotos, cores, tamanhos, preço de venda, promoção e estoque comercial.
- **Cores:** cadastro central de cores, com identidade imutável, compartilhado por produtos e produção.
- **Insumos:** matéria-prima, unidade de medida, fornecedores, entradas, saldo e custo de aquisição.
- **Composições:** ligação entre o produto acabado e os insumos necessários para fabricá-lo.

O custo calculado pela produção poderá ser exibido no produto apenas como informação gerencial (por exemplo, custo e margem estimada), sem ser editado na tela de Produtos e sem substituir o preço de venda.

## 2. Decisões de domínio

### Cadastro de cores e variante produzível

As cores deixam de existir apenas como texto dentro do JSON do produto e passam a ter um **cadastro próprio** (`product_colors`), com identificador imutável. O nome da cor é um rótulo editável; fichas, ordens e variantes referenciam sempre o `color_id`, nunca o nome nem a posição no array.

Consequências:

- renomear uma cor ("Azul Marinho" → "Azul Noite") não afeta variantes, fichas ou ordens;
- a mesma cor pode ser reaproveitada em vários produtos, com código hex, referência Pantone e fornecedor centralizados;
- o JSON do produto passa a guardar apenas a referência (`color_id`) e dados específicos daquele produto (fotos por cor, por exemplo).

Uma peça produzível é identificada por `produto + color_id + tamanho`, materializada em `product_variants` com SKU único e estável.

### Ordem em grade

Uma ordem de produção comporta **várias variantes do mesmo produto** (grade de cores/tamanhos), refletindo a realidade do corte por enfesto. Uma ordem de variante única é apenas uma grade com um item — o modelo é o mesmo; as telas podem ocultar a grade quando houver um item só.

- As quantidades (planejada, aprovada, refugada, segunda qualidade) são registradas **por item da grade**.
- Consumo de material e apontamentos de tempo são registrados **no nível da ordem/etapa**, pois o enfesto e a operação são compartilhados.
- O custo de material é rateado entre os itens proporcionalmente ao **consumo padrão da ficha de cada variante** (pesos por tamanho), não por divisão simples de quantidade.
- Mão de obra por peça rateia por quantidade aprovada; mão de obra por hora rateia pelo tempo padrão de cada variante.

### Execução interna ou por terceiros

Cada etapa do roteiro identifica seu executor: `interno` ou `terceiro` (facção), com parceiro opcional. O MVP implementa apenas execução interna, mas o campo já existe para que, no futuro, uma etapa externa registre o custo do serviço por peça e o estoque em poder de terceiros seja derivável das etapas externas em aberto — sem redesenho do modelo.

### Conversão de unidades (tecidos)

Tecido é comprado e estocado em **kg** e consumido pela ficha em **metros**. A conversão usa gramatura e largura útil:

```text
metros = kg × 1000 / (gramatura_g_m2 × largura_util_m)
```

- O **insumo** guarda gramatura e largura **nominais**, usadas na previsão e no custo da ficha.
- O **lote/rolo** guarda gramatura e largura **reais** (e metragem conferida, quando houver), pois variam por partida.
- A conversão efetiva ocorre no momento da reserva/consumo, usando os dados do lote.
- Todo movimento de tecido registra as duas grandezas (`qty_kg` e `qty_m`), evitando reconversões posteriores com fatores que podem ter mudado.

Subproduto gerencial: comparação entre rendimento real e nominal por lote e por fornecedor.

### Ficha técnica versionada

A composição é uma ficha técnica (BOM — lista de materiais) versionada. Uma nova versão pode ser publicada sem alterar ordens antigas. A ficha contém:

- variante de produto acabado (ou ficha-base no nível do produto, com ajustes por cor/tamanho);
- rendimento esperado;
- percentual de perda padrão;
- insumos e quantidades por unidade produzida;
- roteiro produtivo e tempos padrão;
- vigência e status (`rascunho`, `ativa`, `inativa`).

**Regra de unicidade:** não podem existir duas fichas ativas com vigências sobrepostas para a mesma variante/produto — constraint explícita, não apenas convenção.

### Qualidade: aprovada, segunda qualidade, retrabalho e refugo

A revisão produz **quatro** saídas, não duas:

- **Aprovada (1ª qualidade):** entra no estoque comercial normal.
- **Segunda qualidade:** peça vendável com defeito leve; entra no estoque acabado com marcação própria e não se mistura à primeira linha.
- **Retrabalho:** a peça retorna a uma etapa anterior (tipicamente Costura); a etapa pode ser reexecutada e o tempo adicional é apontado e custeado na ordem.
- **Refugo:** perda definitiva; não entra no denominador de peças boas, mas seu custo permanece na ordem.

### Custos históricos imutáveis

O custo atual serve para previsão. Ao liberar/consumir uma ordem, os valores usados são copiados para lançamentos da ordem. Uma compra posterior de tecido não muda o custo de peças já produzidas.

**Estornos:** devolução de consumo retorna ao estoque pelo **custo congelado do movimento original**, nunca pelo custo médio corrente — evita inconsistência do custo médio móvel com lançamentos fora de ordem cronológica.

### Insumo, compra e despesa não são a mesma coisa

- **Insumo:** item físico consumido — tecido, linha, elástico, etiqueta, embalagem.
- **Pedido de compra:** intenção de compra; pode ser recebido em mais de uma remessa.
- **Recebimento/entrada:** quantidade efetivamente recebida com custo unitário, fornecedor, data, documento e lote. Compra ≠ entrada: o modelo aceita **recebimento parcial**, e o rateio de despesas ocorre por recebimento.
- **Despesa adicional:** frete, imposto não recuperável ou outra despesa rateável.
- **Mão de obra:** custo de uma operação/setor, por peça, hora ou lote.
- **Custo indireto:** energia, aluguel, manutenção; segunda fase.

O custo unitário do insumo é formado pela compra mais despesas rateadas. Para o MVP: **custo médio ponderado móvel**, mantendo lotes para permitir FIFO no futuro.

### Impostos no custo (contexto fiscal)

O que entra no custo do insumo depende do regime tributário:

- **Simples Nacional:** impostos da compra em geral não são recuperáveis → compõem o custo.
- **Lucro Presumido/Real:** ICMS/IPI/PIS/COFINS recuperáveis **não** entram no custo; apenas a parcela não recuperável entra.

A tela de compras deve permitir marcar, por despesa/imposto, se compõe custo ou não. A definição do regime é pendência de negócio (seção 12), mas o modelo já comporta ambos. As regras tributárias finais devem ser validadas com a contabilidade da Lemoov. A **importação de XML de NF-e faz parte do MVP** para reduzir digitação e erros.

### Colaboradores e identificação no apontamento

Colaboradores/equipes são entidades cadastradas (`production_workers`), com custo/hora quando a mão de obra for horista. O apontamento no chão de fábrica não usará login individual: identificação por **seleção de nome + PIN** em dispositivo compartilhado. Toda escrita relevante registra o ator (admin logado ou colaborador identificado).

### Estoque em processo (WIP)

O WIP é **derivado**, não digitado: para cada ordem não concluída, `WIP = consumos realizados + mão de obra apontada − valor já entregue ao estoque acabado`. Um relatório consolida o WIP por ordem e por setor (onde as peças estão paradas). Não há tabela de saldo de WIP no MVP.

## 3. Fluxo operacional

1. Cadastrar unidades de medida, cores, insumos e colaboradores.
2. Registrar compras, recebimentos (totais ou parciais) e despesas adicionais; o sistema atualiza estoque e custo médio.
3. Cadastrar setores produtivos: Corte, Costura, Revisão, Embalagem (exemplo).
4. Criar e publicar a ficha técnica do produto/variante, com materiais e roteiro.
5. Abrir uma ordem de produção com a grade (variantes × quantidades) e datas.
6. Ao liberar a ordem, reservar os insumos previstos e congelar a versão da ficha e os custos previstos.
7. Registrar consumo real, perdas e avanço de quantidade em cada etapa/setor.
8. Na revisão, classificar: aprovada, segunda qualidade, retrabalho (retorna à etapa anterior) ou refugo.
9. Registrar mão de obra real ou aplicar o custo padrão da operação.
10. Na finalização (total ou **parcial**), dar baixa no consumo real, liberar sobras reservadas e dar entrada das peças aprovadas (1ª e 2ª qualidade, com marcação) no estoque de produto acabado.
11. Calcular custo realizado, produtividade, perdas e variações contra o planejado.

Estados sugeridos da ordem:

`rascunho → planejada → liberada → em_producao → parcialmente_concluida → concluida`

Saídas alternativas: `pausada` e `cancelada`. Regras:

- **Conclusão parcial:** entrega peças prontas ao estoque sem fechar a ordem; a ordem fecha quando o restante for concluído ou cancelado.
- **Superprodução:** tolerância configurável (ex.: até 5% acima do planejado) sem exigir nova ordem; acima disso, ajuste auditado.
- Ordem concluída não é editada; correções geram movimentos de ajuste auditáveis.
- Cancelamento libera reservas; consumos já realizados exigem estorno explícito.

## 4. Telas do admin

### Navegação proposta

No menu lateral, **Produção** é um grupo próprio, separado de **Produtos** e **Estoque de produtos acabados**:

```text
Produtos
Estoque
Produção
  Visão geral
  Cores
  Insumos
  Compras de insumos
  Composições
  Setores e operações
  Colaboradores
  Ordens de produção
  Apontamentos
  Custos e produtividade
```

Preço de compra e despesas de insumos nunca são digitados no formulário do produto acabado.

### Visão geral de Produção

KPIs do período:

- ordens em andamento e atrasadas;
- peças planejadas, aprovadas, segunda qualidade e refugadas;
- custo previsto x realizado;
- custo médio por peça;
- eficiência (produção real versus padrão);
- perdas de insumo;
- valor em processo (WIP) por setor;
- gargalo por setor;
- **necessidade de compra:** dadas as ordens planejadas/liberadas e as reservas, o que falta comprar e quando (MRP simplificado, derivado das reservas x saldo disponível).

### Cores

Lista com código, nome, hex, referência Pantone (opcional), situação e contagem de produtos que a utilizam. Não permite exclusão de cor referenciada — apenas inativação. A tela de Produtos seleciona cores deste cadastro em vez de digitá-las livremente.

### Insumos

Lista com código, nome, categoria, unidade, saldo disponível/reservado, estoque mínimo, custo médio e situação. Para tecidos: gramatura e largura nominais. O detalhe mostra movimentações, lotes (com gramatura/largura reais), fornecedores e histórico de custos. Ações de **ajuste de inventário** (contagem física x sistema) com motivo obrigatório e ator.

### Compras de insumos

Cabeçalho da compra, fornecedor, documento, data e itens. Permite:

- **recebimentos parciais** (a compra pode ser confirmada em mais de uma remessa);
- despesas adicionais com regra de rateio por valor, quantidade ou peso, e marcação de composição de custo (recuperável ou não);
- **devolução ao fornecedor** e estorno de recebimento confirmado, com movimento reverso auditado.

Cada confirmação de recebimento gera movimentos de estoque e novos custos.

#### Importação de XML de NF-e

A tela de Compras de insumos terá a ação **Importar XML de NF-e**. O upload não movimenta estoque imediatamente: primeiro cria uma importação em rascunho para conferência.

Fluxo:

1. receber somente arquivo XML dentro do limite configurado;
2. interpretar a NF-e sem resolver entidades externas e sem executar conteúdo do arquivo;
3. validar estrutura mínima, chave de acesso, emitente, destinatário, número, série e totais;
4. impedir importação duplicada pela chave de acesso de 44 dígitos;
5. localizar ou sugerir o fornecedor pelo CNPJ;
6. relacionar cada item da nota a um insumo pelo código do fornecedor, EAN ou vínculo previamente salvo;
7. deixar itens não reconhecidos pendentes para associação manual ou criação de novo insumo;
8. apresentar quantidades, unidades, valores, descontos, frete, seguro, outras despesas e impostos para conferência;
9. converter a unidade fiscal do fornecedor para a unidade de estoque quando existir regra cadastrada;
10. salvar a compra/recebimento como rascunho;
11. somente após confirmação do usuário gerar lotes, movimentos de entrada e atualização do custo médio.

O sistema armazenará **no MySQL** o XML original, o hash SHA-256 do arquivo, a chave da NF-e e o resultado normalizado da leitura. A interpretação automática nunca decide sozinha se um tributo é recuperável: a parametrização fiscal da empresa e a conferência do usuário determinam quais valores compõem o custo.

Como o XML contém dados fiscais e cadastrais, download e consulta ficam restritos a usuários autorizados, toda visualização/importação registra ator e horário, e o conteúdo não será servido por rota pública. A aplicação deve aplicar limite de tamanho e parser protegido contra XXE/entity expansion.

Cancelamento, carta de correção e manifestação do destinatário não fazem parte do primeiro importador. O MVP importa o XML autorizado fornecido pelo usuário; consulta automática à SEFAZ pode ser adicionada posteriormente.

### Fichas técnicas / Composições

Seleção do produto acabado e variante, lista de materiais, perda esperada, rendimento e custo calculado. Inclui roteiro por setores, executor (interno/terceiro), tempo padrão e custo de mão de obra. Exibe versões, permite duplicar uma versão para revisão e impede duas fichas ativas sobrepostas para a mesma variante.

### Setores e operações

Cadastro do setor/local, capacidade diária, custo/hora e situação. Operações definem nome, setor, sequência, tempo padrão, forma de cobrança e custo padrão. Inclui **calendário produtivo** simples (dias úteis, feriados, paradas), usado nos cálculos de atraso e capacidade.

### Colaboradores

Cadastro de colaborador/equipe, setor padrão, forma de remuneração (peça/hora), custo/hora quando aplicável, PIN de apontamento e situação.

### Ordens de produção

Lista filtrável e quadro por status. O detalhe contém: resumo; **grade** (linhas = variantes; colunas = planejada, aprovada, 2ª qualidade, refugada); materiais previstos/reais; etapas com executor; apontamentos; retrabalhos; perdas; custos rateados por item; histórico. Ações: liberar, conclusão parcial, concluir, pausar, cancelar. A conclusão integra o saldo aprovado (com marcação de qualidade) ao estoque acabado.

### Apontamento de produção

Tela simples, adequada ao chão de fábrica: colaborador (nome + PIN), ordem, etapa, início/fim, quantidade recebida, aprovada, segunda qualidade, retrabalho, perdida e observação. Pode futuramente receber QR Code.

### Custos e produtividade

Relatórios por produto, variante, ordem, período, setor, colaborador e equipe. Principais comparações: previsto x realizado, materiais x mão de obra, custo unitário, tempo unitário, rendimento, refugo, retrabalho e rendimento real x nominal de tecido por fornecedor.

## 5. Modelo de dados proposto

Usar tabelas relacionais para o núcleo produtivo, evitando documentos JSON para saldos, custos e vínculos financeiros.

### Cadastros

- `production_units`: `id`, `code`, `name`, `precision`.
- `product_colors`: `id`, `code`, `name`, `hex`, `pantone` (opcional), `active`. Identidade imutável; nome é rótulo editável.
- `product_variants`: `id`, `product_id`, `color_id` (FK), `size`, `sku`, `active`; `sku` único; `product_id + color_id + size` único.
- `production_materials`: `id`, `code`, `name`, `category`, `unit_id`, `min_stock`, `active`; para tecidos: `gramatura_nominal`, `largura_util_nominal`, `stock_unit`, `consumption_unit`.
- `production_suppliers`: `id`, dados cadastrais, `active`.
- `production_partners`: `id`, dados cadastrais, `active` — facções/terceiros (uso futuro).
- `production_sectors`: `id`, `name`, `description`, `daily_capacity`, `hourly_overhead`, `active`.
- `production_operations`: `id`, `sector_id`, `name`, `cost_method`, `standard_minutes`, `standard_cost`, `active`.
- `production_workers`: `id`, `name`, `team`, `default_sector_id`, `pay_method`, `hourly_cost`, `pin_hash`, `active`.
- `production_calendar`: `date`, `is_working_day`, `note`.

### Compras e estoque de insumos

- `material_purchases`: cabeçalho, fornecedor, documento, datas, origem (`manual`, `nfe_xml`), chave da NF-e opcional, status (`aberta`, `parcialmente_recebida`, `recebida`, `cancelada`) e totais.
- `material_purchase_items`: insumo, quantidade pedida, preço, desconto.
- `material_purchase_receipts`: recebimento (remessa) da compra, data, documento; itens recebidos com quantidade e custo alocado.
- `material_purchase_expenses`: recebimento, tipo, valor, método de rateio, `composes_cost` (recuperável ou não).
- `material_nfe_imports`: chave de acesso única, emitente/destinatário, número, série, emissão, totais, hash, XML original em `MEDIUMBLOB`, dados normalizados, status, erros e ator.
- `material_supplier_item_mappings`: fornecedor, código/EAN do item no XML, insumo interno e regra de conversão de unidade; vínculo único por fornecedor + código externo.
- `material_lots`: entrada, saldo, custo unitário formado, referência do recebimento; para tecidos: `gramatura_real`, `largura_real`, `metragem_conferida`.
- `material_stock_movements`: insumo, lote opcional, tipo (`entrada`, `consumo`, `estorno`, `ajuste_inventario`, `perda_avulsa`, `devolucao_fornecedor`, `saida_avulsa`), quantidade, `qty_alt` (unidade de consumo convertida), custo unitário, origem (`origin_type`, `origin_id`), motivo, ator e data.
- `material_stock_reservations`: ordem, insumo, quantidade reservada/consumida/liberada.

Todo saldo de matéria-prima deve ser derivável dos movimentos; coluna de saldo pode existir como cache transacional, nunca como única fonte. Consumo sem ordem (peça piloto/amostra) usa ordem do tipo `amostra` ou movimento de `saida_avulsa` com motivo.

### Ficha técnica

- `bom_headers`: variante/produto, versão, rendimento, perda padrão, status e vigência; a publicação valida, dentro de transação e com bloqueio, que não haja sobreposição de fichas ativas.
- `bom_materials`: ficha, insumo, quantidade, unidade e perda específica.
- `bom_routes`: ficha, operação, sequência, tempo padrão, custo padrão, `executor_type` padrão.

### Execução

- `production_orders`: número (gerado por sequência transacional, nunca MAX+1), `product_id`, tipo (`normal`, `amostra`), tolerância de superprodução, datas, status e custos previstos/realizados totais.
- `production_order_items`: ordem, `variant_id`, `bom_id` e versão congelada da ficha efetiva, `qty_planned`, `qty_approved`, `qty_second_quality`, `qty_scrapped`, custos rateados previsto/realizado. Cada item da grade congela sua própria ficha.
- `production_order_materials`: snapshot do previsto e registro do consumido, perdido, devolvido e custo realizado (congelado).
- `production_order_steps`: snapshot do roteiro, setor/operação, sequência, `executor_type`, `partner_id` opcional, quantidades, contagem de reexecuções (retrabalho) e status.
- `production_time_entries`: etapa, `worker_id`/equipe, início/fim, minutos, quantidades e custo.
- `production_losses`: ordem, etapa opcional, tipo (`refugo`, `perda_insumo`), quantidade, motivo e custo.
- `production_deliveries`: entregas parciais/finais ao estoque acabado — ordem, item, quantidade, qualidade (`primeira`, `segunda`), custo transferido do WIP, data, ator.
- `production_events`: trilha de auditoria com ator (admin ou colaborador), evento, data e dados relevantes.

Valores monetários usam `DECIMAL`, nunca ponto flutuante. Quantidades aceitam casas decimais (metros, quilos, cones).

## 6. Fórmulas principais

```text
custo_unitario_entrada =
  (valor_liquido_dos_itens + despesas_rateadas_que_compoem_custo)
  / quantidade_recebida

custo_medio_novo =
  (saldo_anterior × custo_medio_anterior + entrada × custo_unitario_entrada)
  / (saldo_anterior + entrada)

conversao_tecido:
  metros = kg × 1000 / (gramatura_do_lote × largura_util_do_lote)

consumo_previsto (por item da grade) =
  qty_planejada_item × quantidade_da_ficha_da_variante × (1 + perda_padrao)

consumo_previsto_da_ordem = soma(consumo_previsto dos itens)

custo_material_real_da_ordem =
  soma(consumo_real × custo_congelado_do_movimento)

rateio_material_por_item:
  peso_item = qty_aprovada_item × consumo_padrao_da_variante
  custo_material_item = custo_material_da_ordem × peso_item / soma(pesos)

custo_mao_de_obra_real =
  soma(custo_por_peca × quantidade ou custo_hora × horas_apontadas)
  (inclui horas de retrabalho)

rateio_mo_por_item:
  por_peca  → proporcional a qty_aprovada_item
  por_hora  → proporcional a (qty_aprovada_item × tempo_padrao_da_variante)

custo_unitario_real_item =
  custo_total_rateado_do_item / qty_aprovada_item
  (segunda qualidade: política definida — ver seção 12)

estorno_de_consumo: retorna ao estoque pelo custo congelado do movimento original

wip_da_ordem =
  custos_acumulados − custos_transferidos_nas_entregas − estornos

produtividade = quantidade_aprovada / horas_trabalhadas
eficiencia = minutos_padrao_para_producao / minutos_reais
```

Refugos não entram no denominador de peças boas, mas seus custos permanecem na ordem e elevam o custo unitário realizado. Retrabalho não altera quantidades, apenas adiciona custo de mão de obra.

## 7. APIs sugeridas

Sob `/api/admin/production` e protegidas por `authRequired`:

- `/colors`;
- `/materials`, `/materials/:id/movements`, `/materials/:id/adjust`;
- `/purchases`, `/purchases/:id/receipts`, `/purchases/:id/receipts/:rid/confirm`, `/purchases/:id/returns`;
- `/nfe-imports`, `/nfe-imports/:id`, `/nfe-imports/:id/map-items`, `/nfe-imports/:id/create-draft`;
- `/sectors`, `/operations`, `/workers`, `/calendar`;
- `/variants`;
- `/boms`, `/boms/:id/publish`;
- `/orders`, `/orders/:id/release`, `/orders/:id/cancel`;
- `/orders/:id/material-consumptions` (e estornos);
- `/orders/:id/steps/:stepId/start`, `/finish`, `/rework`;
- `/orders/:id/deliveries` (conclusão parcial);
- `/orders/:id/complete`;
- `/dashboard`, `/reports/costs`, `/reports/wip`, `/reports/purchase-needs`.

Operações de confirmação, liberação, consumo, entrega e conclusão usam transação MySQL e bloqueio das linhas de saldo relevantes. Repetições de requisição aceitam chave de idempotência para não duplicar movimentos. Apontamentos do chão de fábrica autenticam colaborador por PIN sobre sessão de dispositivo.

## 8. Integração com o sistema atual

### Sincronização Produtos ↔ Produção

1. **Migração (Fase 0):** script extrai as cores de todos os JSONs de produtos, deduplica por nome normalizado, cria `product_colors` e regrava cada produto referenciando `color_id`. Casos ambíguos (mesmo nome, tons diferentes) passam por revisão manual antes da consolidação. Em seguida gera `product_variants` para cada combinação cor × tamanho. Critério de aceite: nenhum produto sem `color_id` resolvido; contagem de variantes conferida contra as combinações originais; saldo derivado = saldo cache.
2. **Regime permanente:** ao salvar um produto, um hook compara combinações cor × tamanho com as variantes existentes: combinação nova → cria variante automaticamente (SKU gerado); combinação removida → **inativa** a variante, nunca exclui.
3. **Bloqueio com aviso:** ao remover do produto uma cor/tamanho cuja variante possui ficha ativa ou ordem não concluída, a tela de Produtos exibe aviso explícito antes de confirmar; a variante é inativada para novos usos e o histórico permanece.
4. **Exclusões:** cores, variantes e produtos referenciados por ficha ou ordem jamais são apagados — apenas inativados, com registro de ator em `production_events`.

### Demais integrações

- O catálogo atual continua sendo a origem do produto acabado.
- A conclusão (total ou parcial) da ordem chama um **serviço interno de estoque**, em vez de duplicar a lógica da rota HTTP existente; o estoque acabado passa a distinguir qualidade (1ª/2ª) na entrada vinda da produção.
- O estoque acabado passa a possuir a dimensão `quality_grade` (`first`, `second`), impedindo que segunda qualidade seja somada ao saldo comercial de primeira qualidade.
- O movimento de entrada do acabado recebe `origin_type = production_order` e `origin_id`.
- A interface pode continuar no admin atual inicialmente, mas o JavaScript deve ser separado em `producao-admin.js` e o backend em módulos de domínio/rotas, evitando ampliar o arquivo único.

## 9. Regras críticas

- Não publicar ficha sem materiais ou sem variante válida; o serviço de publicação impede duas fichas ativas sobrepostas usando transação e bloqueio das fichas da variante.
- Não liberar ordem sem ficha ativa e estoque suficiente, salvo permissão explícita para estoque negativo.
- Não permitir consumo/devolução maior que limites coerentes sem justificativa.
- Não concluir ordem com etapas obrigatórias abertas.
- `aprovada + segunda + refugada` não pode exceder a quantidade processada sem ajuste auditado; superprodução acima da tolerância exige ajuste auditado.
- Estorno de consumo usa o custo congelado do movimento original.
- Ajuste de inventário exige motivo e ator; é o único caminho para corrigir divergência de contagem.
- Toda alteração de custo, saldo, status e quantidade registra ator (admin ou colaborador identificado) e horário.
- Fichas usadas por ordens nunca são apagadas nem modificadas retroativamente.
- Cancelamento libera reservas; consumos já realizados exigem estorno explícito.
- Cores, variantes, insumos e produtos referenciados: inativação, nunca exclusão.

## 10. Entrega em fases

### Fase 0 — Fundação

Cadastro de cores + migração dos JSONs (com revisão manual de ambiguidades); variantes/SKUs estáveis; hook de sincronização Produtos ↔ variantes; cadastro de colaboradores e papéis básicos de permissão (quem cadastra custos, altera fichas, libera e conclui); módulos de backend; serviço transacional de estoque; carga de teste de ponta a ponta como critério de aceite da migração.

### Fase 1 — MVP de custo planejado

Insumos (com gramatura/largura), unidades e conversão kg↔m, compras com recebimento parcial, **importação e conferência de XML de NF-e**, despesas rateadas (marcação recuperável/não recuperável), estoque de matéria-prima com ajuste de inventário, setores/operações/calendário, fichas versionadas com validação transacional de vigência e cálculo do custo previsto por item da grade.

### Fase 2 — Execução produtiva

Ordens em grade, reservas, consumos e estornos, apontamentos com PIN, retrabalho e segunda qualidade, perdas, mão de obra real, conclusão parcial e total com entrada automática de acabado por qualidade, relatório de WIP.

### Fase 3 — Gestão

Dashboard, relatórios de custo e produtividade, necessidade de compra (MRP simplificado), alertas de mínimo/atraso com calendário, capacidade, comparação previsto x realizado e rendimento de tecido por fornecedor.

### Fase 4 — Evoluções

QR Code no chão de fábrica, remessa/retorno de facção (ativando `executor_type = terceiro`), custo indireto, planejamento por demanda, múltiplos depósitos, FIFO por lote, gestão de retalhos aproveitáveis.

## 11. Critérios de sucesso do MVP

- cadastrar uma cor, um insumo (tecido com gramatura/largura) e um colaborador;
- registrar uma compra com recebimento parcial e despesas rateadas;
- importar um XML de NF-e, impedir duplicidade, associar seus itens aos insumos e confirmar a entrada somente após conferência;
- visualizar saldo em kg e metros e custo médio do insumo;
- fazer um ajuste de inventário auditado;
- montar e versionar a composição de uma variante;
- obter custo previsto de material e mão de obra por peça, por item da grade;
- abrir uma ordem em grade, liberar, entregar parcialmente e concluir;
- registrar consumo, estorno, perdas, retrabalho, segunda qualidade, etapas e tempo/mão de obra com colaborador identificado;
- receber automaticamente as peças aprovadas (1ª e 2ª qualidade) no estoque acabado;
- consultar custo realizado por peça, rateado por variante, e variação contra o previsto;
- consultar o WIP das ordens abertas;
- auditar quem realizou cada lançamento.

## 12. Definições de negócio pendentes

Antes da implementação, confirmar:

1. A mão de obra será paga por peça, operação, hora, lote ou combinação dessas formas?
2. Qual é o regime tributário (Simples, Presumido, Real)? Isso define quais impostos compõem o custo do insumo.
3. Além de impostos: frete, embalagem, energia e aluguel entram no custo? Quais desde o MVP?
4. Pode existir estoque negativo de insumo ou a liberação deve ser bloqueada?
5. Qual a tolerância padrão de superprodução (sugestão inicial: 5%)?
6. Segunda qualidade: carrega o mesmo custo unitário da primeira ou recebe custo reduzido (com a diferença absorvida pelas peças de primeira)?
7. O apontamento precisa identificar colaborador individual ou basta equipe/setor? (O modelo suporta ambos; a resposta define a granularidade exigida na tela.)
8. Há transferência parcial de peças entre setores (a Costura começa antes de o Corte terminar tudo)?
9. Quem poderá cadastrar custos, alterar fichas, liberar e concluir ordens? (Papéis a definir na Fase 0.)
10. Quais indicadores e metas serão usados para avaliar produtividade?

### Resolvidas nesta versão

- **Grade:** ordem em grade por padrão; variante única é grade de um item.
- **Terceirização:** MVP interno; modelo preparado via `executor_type`/`partner_id`; remessa/retorno na Fase 4.
- **Lote/rolo:** controlado desde o MVP, com gramatura/largura reais; FIFO fica para fase futura.
- **Cores:** cadastro central `product_colors` com identidade imutável e sincronização automática com o catálogo.
- **XML de NF-e:** importação, conferência e criação de recebimento fazem parte do MVP; consulta automática à SEFAZ fica para evolução.

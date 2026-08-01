# Arquitetura do módulo de produção — Lemoov Admin

## 1. Objetivo

Adicionar ao admin um módulo capaz de responder, com rastreabilidade:

- o que será e o que foi produzido;
- quais insumos cada peça consome;
- por quais setores a peça deve passar e já passou;
- quanto foi gasto com material e mão de obra;
- qual é o custo previsto e o custo realizado por peça;
- qual é a produtividade por período, ordem, setor e colaborador/equipe;
- quanto existe de matéria-prima, produto em processo e produto acabado.

O módulo deve aproveitar o catálogo de produtos acabados e integrar a conclusão da produção ao estoque já existente.

### Separação entre venda e produção

O cadastro atual de **Produtos** não receberá campos de preço ou compra de insumos. São contextos diferentes:

- **Produtos:** produto acabado, fotos, cores, tamanhos, preço de venda, promoção e estoque comercial.
- **Insumos:** matéria-prima, unidade de medida, fornecedores, entradas, saldo e custo de aquisição.
- **Composições:** ligação entre o produto acabado e os insumos necessários para fabricá-lo.

O custo calculado pela produção poderá ser exibido no produto apenas como informação gerencial (por exemplo, custo e margem estimada), sem ser editado na tela de Produtos e sem substituir o preço de venda.

## 2. Decisões de domínio

### Variante produzível

Uma peça produzível deve ser identificada por `produto + cor + tamanho` (SKU). O modelo atual guarda produtos e cores em JSON; portanto, antes de criar fichas técnicas, cada combinação precisa ganhar um identificador estável (`variant_id`/SKU), sem depender do índice da cor no array.

### Ficha técnica versionada

A composição é uma ficha técnica (BOM — lista de materiais) versionada. Uma nova versão pode ser publicada sem alterar ordens antigas. A ficha contém:

- variante de produto acabado;
- rendimento esperado;
- percentual de perda padrão;
- insumos e quantidades por unidade produzida;
- roteiro produtivo e tempos padrão;
- vigência e status (`rascunho`, `ativa`, `inativa`).

Pode haver uma ficha-base no nível do produto e ajustes por cor/tamanho. Exemplo: o tecido varia por tamanho, enquanto linha e etiqueta podem permanecer iguais.

### Custos históricos imutáveis

O custo atual serve para previsão. Ao iniciar/consumir uma ordem, os valores usados devem ser copiados para lançamentos da ordem. Assim, uma compra posterior de tecido não muda o custo de peças que já foram produzidas.

### Insumo, compra e despesa não são a mesma coisa

- **Insumo:** item físico consumido, como tecido, linha, elástico, etiqueta ou embalagem.
- **Entrada de insumo:** quantidade comprada com custo unitário, fornecedor, data, documento e lote.
- **Despesa adicional:** frete, imposto não recuperável ou outra despesa rateável da compra.
- **Mão de obra:** custo de uma operação/setor, por peça, hora ou lote.
- **Custo indireto:** energia, aluguel ou manutenção; recomendável para uma segunda fase.

O custo unitário do insumo será formado pela compra mais despesas rateadas. Para o MVP, recomenda-se custo médio ponderado móvel. A estrutura deve manter lotes para permitir FIFO no futuro.

## 3. Fluxo operacional

1. Cadastrar unidades de medida e insumos.
2. Registrar compras/entradas e despesas adicionais; o sistema atualiza estoque e custo médio.
3. Cadastrar setores produtivos, por exemplo: Corte, Costura, Revisão e Embalagem.
4. Criar e publicar a ficha técnica do produto/variante, com materiais e roteiro.
5. Abrir uma ordem de produção com variante, quantidade planejada e datas.
6. Ao liberar a ordem, reservar os insumos previstos e congelar a versão da ficha e custos previstos.
7. Registrar consumo real, perdas e avanço de quantidade em cada etapa/setor.
8. Registrar mão de obra real ou aplicar o custo padrão da operação.
9. Na finalização, dar baixa no consumo real, liberar sobras reservadas e dar entrada das peças aprovadas no estoque de produto acabado.
10. Calcular custo realizado, produtividade, perdas e variações contra o planejado.

Estados sugeridos da ordem:

`rascunho → planejada → liberada → em_producao → concluida`

Saídas alternativas: `pausada` e `cancelada`. Uma ordem concluída não deve ser editada; correções devem gerar movimentos de ajuste auditáveis.

## 4. Telas do admin

### Navegação proposta

No menu lateral, **Produção** será um grupo próprio, separado de **Produtos** e **Estoque de produtos acabados**:

```text
Produtos
Estoque
Produção
  Visão geral
  Insumos
  Compras de insumos
  Composições
  Setores e operações
  Ordens de produção
  Apontamentos
  Custos e produtividade
```

Cada item abre sua própria tela/painel. Em especial, preço de compra e despesas de insumos nunca serão digitados no formulário do produto acabado.

### Visão geral de Produção

KPIs do período:

- ordens em andamento e atrasadas;
- peças planejadas, aprovadas e refugadas;
- custo previsto x realizado;
- custo médio por peça;
- eficiência (produção real versus padrão);
- perdas de insumo;
- gargalo por setor.

### Insumos

Lista com código, nome, categoria, unidade, saldo disponível/reservado, estoque mínimo, custo médio e situação. O detalhe mostra movimentações, lotes, fornecedores e histórico de custos.

### Compras de insumos

Cabeçalho da compra, fornecedor, documento, data e itens. Permite despesas adicionais e regra de rateio por valor, quantidade ou peso. A confirmação gera movimentos de estoque e novos custos.

### Fichas técnicas / Composições

Seleção do produto acabado e variante, lista de materiais, perda esperada, rendimento e custo calculado. Inclui roteiro por setores, tempo padrão e custo de mão de obra. Deve exibir versões e permitir duplicar uma versão para revisão.

### Setores e operações

Cadastro do setor/local, capacidade diária, custo/hora e situação. Operações definem nome, setor, sequência, tempo padrão, forma de cobrança e custo padrão.

### Ordens de produção

Lista filtrável e quadro por status. O detalhe contém resumo, materiais previstos/reais, etapas, apontamentos, perdas, custos e histórico. A ação “concluir” integra o saldo aprovado ao estoque acabado.

### Apontamento de produção

Tela simples, adequada ao chão de fábrica: ordem, etapa, colaborador/equipe, início/fim, quantidade recebida, aprovada, perdida e observação. Pode futuramente receber QR Code.

### Custos e produtividade

Relatórios por produto, variante, ordem, período, setor e equipe. Principais comparações: previsto x realizado, materiais x mão de obra, custo unitário, tempo unitário, rendimento e refugo.

## 5. Modelo de dados proposto

Usar tabelas relacionais para o núcleo produtivo, evitando documentos JSON para saldos, custos e vínculos financeiros.

### Cadastros

- `production_units`: `id`, `code`, `name`, `precision`.
- `production_materials`: `id`, `code`, `name`, `category`, `unit_id`, `min_stock`, `active`.
- `production_suppliers`: `id`, dados cadastrais e `active`.
- `production_sectors`: `id`, `name`, `description`, `daily_capacity`, `hourly_overhead`, `active`.
- `production_operations`: `id`, `sector_id`, `name`, `cost_method`, `standard_minutes`, `standard_cost`, `active`.
- `product_variants`: `id`, `product_id`, `color_key`, `size`, `sku`, `active`; `sku` único.

### Compras e estoque de insumos

- `material_purchases`: cabeçalho, fornecedor, documento, datas, status e totais.
- `material_purchase_items`: insumo, quantidade, preço, desconto e custo alocado.
- `material_purchase_expenses`: tipo, valor e método de rateio.
- `material_lots`: entrada, saldo, custo unitário formado e referência da compra.
- `material_stock_movements`: insumo, lote opcional, tipo, quantidade, custo unitário, origem e data.
- `material_stock_reservations`: ordem, insumo, quantidade reservada/consumida/liberada.

Todo saldo de matéria-prima deve ser derivável dos movimentos; uma coluna de saldo pode existir como cache transacional, nunca como única fonte.

### Ficha técnica

- `bom_headers`: variante/produto, versão, rendimento, perda padrão, status e vigência.
- `bom_materials`: ficha, insumo, quantidade, unidade e perda específica.
- `bom_routes`: ficha, operação, sequência, tempo padrão e custo padrão.

### Execução

- `production_orders`: número, variante, versão da ficha, quantidades, datas, status e custos previstos/realizados.
- `production_order_materials`: snapshot do previsto e registro do consumido, perdido, devolvido e custo realizado.
- `production_order_steps`: snapshot do roteiro, setor/operação, sequência, quantidades e status.
- `production_time_entries`: etapa, operador/equipe, início/fim, minutos, quantidades e custo.
- `production_losses`: ordem, etapa opcional, tipo, quantidade, motivo e custo.
- `production_events`: trilha de auditoria com ator, evento, data e dados relevantes.

Valores monetários devem usar `DECIMAL`, nunca ponto flutuante. Quantidades precisam aceitar casas decimais por causa de metros, quilos e cones.

## 6. Fórmulas principais

```text
custo_unitario_entrada =
  (valor_liquido_dos_itens + despesas_rateadas) / quantidade_recebida

custo_medio_novo =
  (saldo_anterior × custo_medio_anterior + entrada × custo_unitario_entrada)
  / (saldo_anterior + entrada)

consumo_previsto =
  quantidade_planejada × quantidade_da_ficha × (1 + percentual_de_perda)

custo_material_real =
  soma(consumo_real × custo_congelado_do_movimento)

custo_mao_de_obra_real =
  soma(custo_por_peca × quantidade ou custo_hora × horas_apontadas)

custo_unitario_real =
  (materiais + mao_de_obra + custos_indiretos_alocados) / quantidade_aprovada

produtividade = quantidade_aprovada / horas_trabalhadas
eficiencia = minutos_padrao_para_producao / minutos_reais
```

Refugos não entram no denominador de peças boas, mas seus custos permanecem na ordem e elevam o custo unitário realizado.

## 7. APIs sugeridas

Sob `/api/admin/production` e protegidas por `authRequired`:

- `/materials`, `/materials/:id/movements`;
- `/purchases`, `/purchases/:id/confirm`;
- `/sectors`, `/operations`;
- `/variants`;
- `/boms`, `/boms/:id/publish`;
- `/orders`, `/orders/:id/release`, `/orders/:id/cancel`;
- `/orders/:id/material-consumptions`;
- `/orders/:id/steps/:stepId/start` e `/finish`;
- `/orders/:id/complete`;
- `/dashboard` e `/reports/costs`.

Operações de confirmação, liberação, consumo e conclusão devem usar transação MySQL e bloqueio das linhas de saldo relevantes. Repetições de requisição devem aceitar uma chave de idempotência para não duplicar movimentos.

## 8. Integração com o sistema atual

- O catálogo atual continua sendo a origem do produto acabado.
- Uma migração cria SKUs estáveis para cada combinação de cor/tamanho.
- A conclusão da ordem chama um serviço interno de estoque, em vez de duplicar a lógica da rota HTTP existente.
- O movimento de entrada do acabado recebe `origin_type = production_order` e `origin_id`.
- Exclusão de produto/variante referenciado por ficha ou ordem deve ser proibida; utilizar inativação.
- A interface pode continuar no admin atual inicialmente, mas o JavaScript deve ser separado em `producao-admin.js` e o backend em módulos de domínio/rotas, evitando ampliar ainda mais o arquivo único.

## 9. Regras críticas

- Não permitir publicar ficha sem materiais ou sem variante válida.
- Não liberar ordem sem ficha ativa e estoque suficiente, salvo permissão explícita para estoque negativo.
- Não permitir consumo/devolução maior que limites coerentes sem justificativa.
- Não concluir ordem com etapas obrigatórias abertas.
- Quantidade aprovada + refugada não pode exceder a quantidade processada sem ajuste auditado.
- Toda alteração de custo, saldo, status e quantidade deve registrar ator e horário.
- Fichas usadas por ordens nunca são apagadas nem modificadas retroativamente.
- Cancelamento libera reservas; consumos já realizados exigem estorno explícito.

## 10. Entrega em fases

### Fase 0 — Fundação

Criar variantes/SKUs estáveis, módulos de backend, permissões futuras e serviço transacional de estoque.

### Fase 1 — MVP de custo planejado

Insumos, unidades, compras, despesas rateadas, estoque de matéria-prima, setores/operações, fichas versionadas e cálculo do custo previsto.

### Fase 2 — Execução produtiva

Ordens, reservas, consumos, apontamentos, perdas, mão de obra real, conclusão e entrada automática de produto acabado.

### Fase 3 — Gestão

Dashboard, relatórios, alertas de mínimo/atraso, capacidade e comparação previsto x realizado.

### Fase 4 — Evoluções

QR Code no chão de fábrica, terceiros/facções, custo indireto, planejamento por demanda, múltiplos depósitos e FIFO por lote.

## 11. Critérios de sucesso do MVP

- cadastrar um insumo e registrar uma compra com despesas;
- visualizar saldo e custo médio do insumo;
- montar e versionar a composição de uma variante;
- obter custo previsto de material e mão de obra por peça;
- abrir, liberar e concluir uma ordem;
- registrar consumo, perdas, etapas e tempo/mão de obra;
- receber automaticamente as peças aprovadas no estoque acabado;
- consultar custo realizado por peça e variação contra o previsto;
- auditar quem realizou cada lançamento.

## 12. Definições de negócio pendentes

Antes da implementação, confirmar:

1. A produção é interna, terceirizada (facções) ou ambas?
2. A mão de obra será paga por peça, operação, hora, lote ou combinação dessas formas?
3. O apontamento precisa identificar colaborador individual ou somente equipe/setor?
4. É necessário controlar lote/rolo e cor do tecido desde o MVP?
5. O custo deve incluir impostos, frete, embalagem, energia e aluguel? Quais deles?
6. Pode existir estoque negativo de insumo ou a liberação deve ser bloqueada?
7. Uma ordem produzirá uma única variante ou uma grade com várias cores/tamanhos?
8. Há produção parcial e transferência parcial entre setores?
9. Quem poderá cadastrar custos, alterar fichas, liberar e concluir ordens?
10. Quais indicadores e metas serão usados para avaliar produtividade?

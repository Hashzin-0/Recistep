# Recistep

Aplicativo de receitas inteligentes: importação de fontes de mídia autorizadas, extração assistida por IA, organização de ingredientes e planejamento do preparo.

## Estado do projeto

Repositório inicializado. A implementação será feita em etapas verificáveis, preservando segredos e usando fontes reais. Recursos externos só serão habilitados após validação de acesso e configuração.

## Princípios

- Não inventar dados extraídos nem apresentar estimativas como fatos.
- Manter credenciais exclusivamente no servidor.
- Validar URLs e restringir aquisição de mídia a conectores autorizados.
- Persistir estados de tarefas e permitir recuperação de falhas.
- Aplicar autorização no servidor e políticas de banco quando houver persistência.
- Executar e relatar testes reais antes de declarar a implementação validada.

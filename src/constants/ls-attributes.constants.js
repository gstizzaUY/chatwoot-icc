/**
 * Preguntas LS de "Informaciones del contacto".
 * Se crean como atributos `list` en Chatwoot (cuenta central y Sellers).
 */

export const LS_ATTRIBUTE_DEFINITIONS = Object.freeze([
    {
        attribute_key: 'ls_seguis_algun_tipo_de_alimentacion',
        attribute_display_name: '¿Seguís algún tipo de alimentación?',
        attribute_description: 'Estilo de alimentación del contacto',
        attribute_display_type: 'list',
        attribute_model: 'contact_attribute',
        attribute_values: [
            'Sin restricciones',
            'Vegetariana',
            'Vegana',
            'Sin gluten',
            'Keto / Low Carb',
            'Diabética',
            'Otra',
        ],
        regex_pattern: null,
        regex_cue: null,
    },
    {
        attribute_key: 'ls_que_suele_pasar_mas_seguido_en_tu_casa',
        attribute_display_name: '¿Qué suele pasar más seguido en tu casa?',
        attribute_description: 'Hábitos de cocina del contacto',
        attribute_display_type: 'list',
        attribute_model: 'contact_attribute',
        attribute_values: [
            'Cocinamos casi todos los días',
            'Combinamos cocina y delivery',
            'Pedimos delivery varias veces por semana',
            'Resolvemos las comidas sobre la marcha',
        ],
        regex_pattern: null,
        regex_cue: null,
    },
    {
        attribute_key: 'ls_con_que_frecuencia_comes_comida_casera',
        attribute_display_name: '¿Con qué frecuencia comés comida casera?',
        attribute_description: 'Frecuencia de comida casera',
        attribute_display_type: 'list',
        attribute_model: 'contact_attribute',
        attribute_values: [
            'Todos los días',
            'Varias veces por semana',
            'Algunas veces',
            'Muy pocas veces',
        ],
        regex_pattern: null,
        regex_cue: null,
    },
    {
        attribute_key: 'ls_para_cuantas_personas_cocinas_habitualmente',
        attribute_display_name: '¿Para cuántas personas cocinas habitualmente?',
        attribute_description: 'Cantidad de personas para las que cocina',
        attribute_display_type: 'list',
        attribute_model: 'contact_attribute',
        attribute_values: [
            'Solo para mí',
            'Para 2 personas',
            'Para 3 o 4 personas',
            'Para más de 5',
        ],
        regex_pattern: null,
        regex_cue: null,
    },
    {
        attribute_key: 'ls_cual_describe_mejor_tu_rutina',
        attribute_display_name: '¿Cuál describe mejor tu rutina?',
        attribute_description: 'Rutina del contacto',
        attribute_display_type: 'list',
        attribute_model: 'contact_attribute',
        attribute_values: [
            'Tengo poco tiempo para cocinar durante la semana',
            'Trabajo desde casa',
            'Tengo horarios muy variables',
            'Mi rutina cambia todos los días',
        ],
        regex_pattern: null,
        regex_cue: null,
    },
    {
        attribute_key: 'ls_con_que_frecuencia_cocinas',
        attribute_display_name: '¿Con qué frecuencia cocinas?',
        attribute_description: 'Frecuencia con la que cocina',
        attribute_display_type: 'list',
        attribute_model: 'contact_attribute',
        attribute_values: [
            'Todos los días',
            '2 o 3 veces por semana',
            'Menos de 2 veces por semana',
        ],
        regex_pattern: null,
        regex_cue: null,
    },
    {
        attribute_key: 'ls_cual_de_estas_frases_te_representa_mejor',
        attribute_display_name: '¿Cuál de estas frases te representa mejor?',
        attribute_description: 'Preferencia del contacto sobre la cocina',
        attribute_display_type: 'list',
        attribute_model: 'contact_attribute',
        attribute_values: [
            'Me gusta organizar las comidas de la semana',
            'Voy resolviendo qué cocinar día a día',
            'Muchas veces termino pidiendo delivery',
            'Me cuesta encontrar tiempo para cocinar',
        ],
        regex_pattern: null,
        regex_cue: null,
    },
]);

export default LS_ATTRIBUTE_DEFINITIONS;

import axios from 'axios';

const createBatch = async (req, res) => {

    const custom_atributes = req.body.custom_attribute_definition;

    const url = "https://contact-center.5vsa59.easypanel.host/api/v1/accounts/2/custom_attribute_definitions?account_id=2";
    const api_access_token = "W7S5JM2e4XJeKDELkg3kCaBf";
    const headers = {
        'Content-Type': 'application/json',
        "api_access_token": api_access_token,
    };

    for (const custom_attribute of custom_atributes) {
        try {
            const response = await axios.post(url, custom_attribute, { headers });
            console.log('Atributo personalizado creado:', response.data);
        } catch (error) {
            console.error(`Error al crear atributo personalizado con id ${custom_attribute.id}:`, error.message);
            return res.status(500).json({ error: `Error al crear atributo con id ${custom_attribute.id}: ${error.message}` });
        }
    }

    res.json({ message: 'Todos los atributos fueron creados exitosamente' });
};

const listCustomAttributes = async (req, res) => {
    const attribute_model = req.body.attribute_model;
    console.log('attribute_model:', attribute_model);

    const url = "https://contact-center.5vsa59.easypanel.host/api/v1/accounts/2/custom_attribute_definitions?attribute_model=1";
    const api_access_token = "W7S5JM2e4XJeKDELkg3kCaBf";
    const headers = {
        'Content-Type': 'application/json',
        "api_access_token": api_access_token,
    };

    try {
        const response = await axios.get(url, { headers });
        const listaDeAtributos = response.data;
        console.log('Atributos personalizados:', listaDeAtributos);

        const errores = [];

        // Por cada atributo llamar a la API para borrarlo
        for (const atributo of listaDeAtributos) {
            try {
                const deleteUrl = `https://contact-center.5vsa59.easypanel.host/api/v1/accounts/2/custom_attribute_definitions/${atributo.id}`;
                await axios.delete(deleteUrl, { headers });
                console.log('Atributo personalizado eliminado:', atributo.id);
            } catch (error) {
                if (error.response && error.response.status === 404) {
                    console.warn(`Atributo con id ${atributo.id} no encontrado, se omite.`);
                    continue;
                }
                console.error(`Error al eliminar atributo personalizado con id ${atributo.id}:`, error.message);
                errores.push(`Error al eliminar atributo con id ${atributo.id}: ${error.message}`);
            }
        }

        if (errores.length > 0) {
            return res.status(500).json({ errores });
        }

        res.json({ message: 'Todos los atributos fueron eliminados exitosamente' });
    } catch (error) {
        console.error('Error al listar atributos personalizados:', error.message);
        res.status(500).json({ error: `Error al listar atributos personalizados: ${error.message}` });
    }
};

export { createBatch, listCustomAttributes };